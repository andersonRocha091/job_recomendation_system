import { ITreinamentoRepository } from "@core/ports/out/ITreinamentoRepository";
import { ITreinamentoService } from "@core/ports/in/ITreinamentoService";
import { VocabularyService } from "./VocabularyService";
import { TrainingRow } from "../TrainingRow";
import * as fs from 'fs';

import * as tf from '@tensorflow/tfjs-node';
import { IVagaRepository } from "@core/ports/out/IVagaRepository";
import { IModelStore } from "@core/ports/out/IModelStore";
import { Vaga } from "@core/domain/Vaga";

export interface TrainingMetaData {
    maxExperience: number;
    minExperience: number;
    seniorityList: string[];
    vocabSize: number;
}

export const FEATURE_PROJECTION_LAYER = 'feature_projection_layer';

export class TrainService implements ITreinamentoService {

    private metadata: TrainingMetaData | null = null;
    private readonly FEATURE_PROJECTION_LAYER = FEATURE_PROJECTION_LAYER;
    constructor(
        private readonly treinamentoRepository: ITreinamentoRepository,
        private readonly vocabularyService: VocabularyService,
        private readonly vagaRepository: IVagaRepository,
        private readonly modelStore: IModelStore,
    ) {}

    extractMetadata(rows: TrainingRow[]): TrainingMetaData {
        
        let maxExperience = -Infinity;
        let minExperience = Infinity;
        const seniorities = new Set<string>();

        rows.forEach( row => {

            if (row.anosExperiencia > maxExperience) maxExperience = row.anosExperiencia;
            if (row.anosExperiencia < minExperience) minExperience = row.anosExperiencia;
            seniorities.add(row.nivelSenioridade.toLowerCase());
            
        });

        if (maxExperience === minExperience) maxExperience = minExperience + 1; // prevenindo divisão por zero na normalização

        const seniorityList = Array.from(seniorities);

        this.metadata = {
            maxExperience,
            minExperience,
            seniorityList,
            vocabSize: this.vocabularyService.size()
        };

        return this.metadata;
    }

    async prepareTensor(rows: TrainingRow[]) {

        const MAX_SKILLS = 20; // número máximo de habilidades a considerar (pode ser ajustado conforme necessário)

        this.metadata = this.extractMetadata(rows);
        const { maxExperience, minExperience, seniorityList } = this.metadata;

        const xInputs = rows.map(row => {
           //1 . skills
           const userSkillsTokens = this.vocabularyService.tokenize(row.skillsUsuario, MAX_SKILLS);
           const jobSkillsTokens = this.vocabularyService.tokenize(row.skillsVaga, MAX_SKILLS);
           
           //2. experiência normalizada (min / max scaling)
           const normalizedExperience = (row.anosExperiencia - minExperience) / (maxExperience - minExperience);
           
           // 3. senioridade one-hot encoding
           // seniorityList é derivado das mesmas rows via extractMetadata, portanto
           // a seniority desta row é garantidamente presente na lista
           const oneHotSeniority = new Array(seniorityList.length).fill(0);
           const seniorityIndex = seniorityList.indexOf(row.nivelSenioridade.toLowerCase());
           oneHotSeniority[seniorityIndex] = 1;

           // 4. skill overlap: fração das skills da vaga que o usuário possui (recall)
           //    e fração das skills do usuário que a vaga exige (coverage)
           const userSkillsSet = new Set(row.skillsUsuario.map(s => s.toLowerCase()));
           const matchCount = row.skillsVaga.filter(s => userSkillsSet.has(s.toLowerCase())).length;
           const skillRecall   = matchCount / Math.max(row.skillsVaga.length, 1);
           const skillCoverage = matchCount / Math.max(row.skillsUsuario.length, 1);

           return [
            ...userSkillsTokens, // 0 to 19 indexes
            normalizedExperience, // 20th index
            ...jobSkillsTokens, // 21 to 40 indexes
            ...oneHotSeniority, // 41 to 40 + n indexes
            skillRecall,   // 41 + n
            skillCoverage  // 42 + n
           ]
        });

        const yLabels = rows.map(row => row.contratado);

        return { 
            xInputs: tf.tensor2d(xInputs), 
            yLabels: tf.tensor2d(yLabels, [yLabels.length, 1]),
            metaData: this.metadata
        };
    }

    buildModel(vocabularySize: number, seniorityCount: number): tf.LayersModel {
        
        // DEFININDO AS ENTRADAS

        // 1. entrada de skills do usuario (20 inteiros)
        const userSkillsInput = tf.input({ shape: [20], name: 'user_skills_input' });
        // 2. entrada de skills da vaga (20 inteiros)
        const jobSkillsInput = tf.input({ shape: [20], name: 'job_skills_input' });
        // 3. entrada numerica: 1 (experiencia normalizada) + N (One-hot senioridade) + 2 (skill overlap)
        const numericInput = tf.input({ shape: [1 + seniorityCount + 2], name: 'numeric_input' });

        //2. Camada de Embedding
        // inputDim: tamanho do vocabulario
        // outputDim: cada skill vira um vetor de 16 dimensões (hiperparâmetro)
        // maskZero: true + GlobalAveragePooling1D: o pooling suporta e propaga a máscara,
        // fazendo a média apenas sobre os tokens reais e ignorando o padding (índice 0)
        const skillEmbedding = tf.layers.embedding({
            inputDim: vocabularySize,
            outputDim: 16,
            maskZero: true,
            name: 'skill_embedding'
        })

        // 3. Processamento das "torres"
        // GlobalAveragePooling1D faz a média dos embeddings dos tokens reais (ignorando padding)
        // e produz um vetor fixo de 16 dimensões — substitui Flatten que não suporta máscaras
        const userFeatures = tf.layers.globalAveragePooling1d().apply(skillEmbedding.apply(userSkillsInput)) as tf.SymbolicTensor;
        const jobFeatures = tf.layers.globalAveragePooling1d().apply(skillEmbedding.apply(jobSkillsInput)) as tf.SymbolicTensor;

        // 4. Concatenando todas as features (skills + numericas)
        // juntamos os vetores de skills do usuário e da vaga com as features numéricas (experiência + senioridade)
        const concatenated = tf.layers.concatenate().apply([
            userFeatures,
            jobFeatures,
            numericInput
        ]);

        //5. Camadas densas para aprendizado (Tomada de decisao)
        const firstDense = tf.layers.dense({ units: 32, activation: 'relu', name: this.FEATURE_PROJECTION_LAYER}).apply(concatenated);
        const secondDense = tf.layers.dense({ units: 16, activation: 'relu'}).apply(firstDense);

        //6. Camada de saída (sigmoid para classificação binária)
        const output = tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'hiring_probability'})
        .apply(secondDense) as tf.SymbolicTensor;

        //7. Criando o modelo final
        const model = tf.model({
            inputs: [userSkillsInput, jobSkillsInput, numericInput],
            outputs: output,
            name: 'hiring_model'
        });

        // Compilando o modelo com otimizador e função de perda adequados para classificação binária
        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'binaryCrossentropy',
            metrics: ['accuracy']
        });

        return model;

    }

    async executarTreinamento(): Promise<void> {
        return this.runTraining();
    }

    async runTraining() {
        console.log('Iniciando processo de treinamento...');
        // 1. extracao e preparacao dos dados do banco
        const rows = await this.treinamentoRepository.getRawTrainingData();

        if (rows.length === 0) {
            throw new Error('Nenhum dado de treinamento encontrado. Verifique se há usuários, vagas e candidaturas no banco.');
        }
        this.vocabularyService.build(rows);
        const { xInputs, yLabels, metaData } = await this.prepareTensor(rows);
        const seniorityCount = metaData.seniorityList.length;

        // 2. Construcao e treino do modelo
        const model = this.buildModel(this.vocabularyService.size(), seniorityCount);
        
        // fatiamento das features para alimentar as entradas separadas do modelo
        const userSkills = xInputs.slice([0, 0], [-1, 20]);
        const jobSkills = xInputs.slice([0, 21], [-1, 20]);
        // numericData: experiência (idx 20) + one-hot seniority (41..40+n) + overlap features (2)
        const nummericData = xInputs.slice([0, 20], [-1, 1])
        .concat(xInputs.slice([0, 41], [-1, seniorityCount + 2]), 1);

        // Peso de classe: compensa o desequilíbrio entre pares contratado (minoria)
        // e não-contratado (maioria). Sem isso, o gradiente dos negativos domina e
        // o modelo colapsa para a taxa base (ex.: ~11% para tudo).
        const positiveCount = rows.filter(r => r.contratado === 1).length;
        const negativeCount = rows.length - positiveCount;
        const classWeight = { 0: 1.0, 1: negativeCount / positiveCount };
        console.log(`Distribuição: ${positiveCount} positivos / ${negativeCount} negativos — class weight positivo: ${classWeight[1].toFixed(2)}x`);

        console.log('Iniciando treinamento do modelo...');
        await model.fit([userSkills, jobSkills, nummericData], yLabels, {
            epochs: 100,
            batchSize: 16,  // batches menores = mais atualizações de gradiente por epoch
            validationSplit: 0.1,
            shuffle: true,
            classWeight,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    if (epoch % 20 === 0) {
                        // TF.js abrevia 'accuracy' como 'acc' nos logs do fit
                        console.log(`Epoch ${epoch}: Loss: ${logs?.loss?.toFixed(4)}, Acc: ${logs?.acc?.toFixed(4)} | Val Loss: ${logs?.val_loss?.toFixed(4)}, Val Acc: ${logs?.val_acc?.toFixed(4)}`);
                    }
                }
            }
        })

        // 3. Persistencia do modelo treinado (exemplo: salvando localmente, mas poderia ser em um bucket, banco, etc)
        const modelPath = './model-data';
        if (!fs.existsSync(modelPath)) fs.mkdirSync(modelPath);
        await model.save(`file://${modelPath}`);

        // IMPORTANTE: Salvar metadados para normalizacao futura
        console.log('Salvando metadados do treinamento...');
        fs.writeFileSync(`${modelPath}/metadata.json`, JSON.stringify(
            {
                ...metaData,
                vocab: Array.from(this.vocabularyService['vocabulary'].entries()) // salvando o mapeamento de skills para índices
            }
        ));
        console.log('Sincronizando embeddings com o banco de dados...');
        await this.syncDatabaseEmbeddings(model);

        // Transfere a propriedade do modelo para o store — não dispor aqui
        this.modelStore.update({
            model,
            vocabulary: this.vocabularyService,
            metadata: this.metadata!,
        });

        tf.dispose([xInputs, yLabels, userSkills, jobSkills, nummericData]);
        console.log('✅ Treinamento concluído com sucesso!');
    }

    async syncDatabaseEmbeddings(model: tf.LayersModel) {

        const extractor = tf.model({
            inputs: model.inputs,
            outputs: model.getLayer(this.FEATURE_PROJECTION_LAYER).output
        });

        const vagasAtivas = await this.vagaRepository.findAll();

        for (const vaga of vagasAtivas) {
            // Bug 1 (fix): tf.tidy retorna o array plain (dataSync já copiou os dados),
            // permitindo o await fora do tidy sem risco de tensor já descartado
            const vectorData = tf.tidy(() => {
                // gerando tensor para cada vaga usando a mesma lógica de preparação de dados (tokenização, normalização, etc)
                const { skills, numeric } = this.prepareSingleJobTensor(vaga);
                const dummyUserSkills = tf.zeros([1, 20]); // preenchendo com zeros pois queremos apenas o embedding da vaga

                const vector = extractor.predict([dummyUserSkills, skills, numeric]) as tf.Tensor;
                return Array.from(vector.dataSync());
            });

            await this.vagaRepository.updateEmbeddings(vaga.id, vectorData); // Bug 1 (fix): await garante propagação de erros e ordem de execução
        }
        // Nota: extractor não é descartado aqui pois compartilha as mesmas instâncias de
        // layer do model original. O descarte é feito via model.dispose() em runTraining().
    }

    prepareSingleJobTensor(vaga: Vaga) {

        const MAX_SKILLS = 20;
        
        if (!this.metadata) throw new Error('Metadata não extraída. Execute extractMetadata() antes.');

        const jobSkillsTokens = this.vocabularyService.tokenize(vaga.habilidades ?? [], MAX_SKILLS);

        // Vagas não possuem anos de experiência numéricos — o requisito de senioridade
        // é capturado pelo one-hot encoding abaixo. Usamos 0 como placeholder para
        // manter o layout do tensor compatível com o treinado em prepareTensor().
        const normalizedExperience = 0;

        const oneHotSeniority = new Array(this.metadata.seniorityList.length).fill(0);
        const seniorityIndex = this.metadata.seniorityList.indexOf(vaga.nivelSenioridade.toLowerCase());
        if (seniorityIndex >= 0) oneHotSeniority[seniorityIndex] = 1;

        // overlap features são 0 no contexto de embedding isolado da vaga (sem usuário de referência)
        return {
            skills: tf.tensor2d([jobSkillsTokens],[1, MAX_SKILLS]),
            numeric: tf.tensor2d([[normalizedExperience, ...oneHotSeniority, 0, 0]],[1, 1 + this.metadata.seniorityList.length + 2])
        }
    }
}