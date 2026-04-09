import { ITreinamentoRepository } from "@core/ports/out/ITreinamentoRepository";
import { VocabularyService } from "./VocabularyService";
import { TrainingRow } from "../TrainingRow";

import * as tf from '@tensorflow/tfjs-node';

export interface TrainingMetaData {
    maxExperience: number;
    minExperience: number;
    seniorityList: string[];
    vocabSize: number;
}

export class TrainService {

    private metadata: TrainingMetaData | null = null;
    
    constructor(
        private readonly treinamentoRepository: ITreinamentoRepository,
        private readonly vocabularyService: VocabularyService
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

           return [
            ...userSkillsTokens, // 0 to 19 indexes
            normalizedExperience, // 20th index
            ...jobSkillsTokens, // 21 to 40 indexes
            ...oneHotSeniority // 41 to 40 + n indexes
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
        // 3. entrada numerica: 1 (experiencia normalizada) + N (One-hot senioridade)
        const numericInput = tf.input({ shape: [1 + seniorityCount], name: 'numeric_input' });

        //2. Camada de Embedding
        // inputDim: tamanho do vocabulario
        // outputDim: cada skill vira um vetor de 16 dimensões (hiperparâmetro)
        const skillEmbedding = tf.layers.embedding({
            inputDim: vocabularySize,
            outputDim: 16,
            maskZero: true, // importante para ignorar o padding (0)
            name: 'skill_embedding'
        })

        // 3. Processamento das "torres"
        // Aplicando o embedding nas entradas de skills e depois flatten para virar vetor plano
        const userFeatures = tf.layers.flatten().apply(skillEmbedding.apply(userSkillsInput)) as tf.SymbolicTensor;
        const jobFeatures = tf.layers.flatten().apply(skillEmbedding.apply(jobSkillsInput)) as tf.SymbolicTensor;

        // 4. Concatenando todas as features (skills + numericas)
        // juntamos os vetores de skills do usuário e da vaga com as features numéricas (experiência + senioridade)
        const concatenated = tf.layers.concatenate().apply([
            userFeatures,
            jobFeatures,
            numericInput
        ]);

        //5. Camadas densas para aprendizado (Tomada de decisao)
        const firstDense = tf.layers.dense({ units: 32, activation: 'relu'}).apply(concatenated);
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
}