import * as tf from '@tensorflow/tfjs-node';
import { IRecomendacaoService, VagaRecomendada } from '@core/ports/in/IRecomendacaoService';
import { IModelStore } from '@core/ports/out/IModelStore';
import { IUsuarioRepository } from '@core/ports/out/IUsuarioRepository';
import { IVagaRepository } from '@core/ports/out/IVagaRepository';
import { FEATURE_PROJECTION_LAYER } from '@core/domain/training/services/TrainService';

const MAX_SKILLS = 20;
const RECOMMENDATION_LIMIT = 10;

export class RecomendacaoService implements IRecomendacaoService {
    constructor(
        private readonly modelStore: IModelStore,
        private readonly usuarioRepository: IUsuarioRepository,
        private readonly vagaRepository: IVagaRepository,
    ) {}

    async recomendar(usuarioId: string): Promise<VagaRecomendada[]> {
        if (!this.modelStore.isReady()) {
            throw new Error('Modelo não disponível. Execute o treinamento primeiro.');
        }

        const { model, vocabulary, metadata } = this.modelStore.getState()!;
        const { minExperience, maxExperience, seniorityList } = metadata;

        const usuario = await this.usuarioRepository.findByIdComHabilidades(usuarioId);
        if (!usuario) throw new Error(`Usuário ${usuarioId} não encontrado.`);

        const vagas = await this.vagaRepository.findAll();

        const expRange = maxExperience - minExperience;
        const normalizedExp = expRange > 0
            ? ((usuario.anosExperiencia ?? 0) - minExperience) / expRange
            : 0;

        const userHabilidades = usuario.habilidades ?? [];
        const userTokens = vocabulary.tokenize(userHabilidades, MAX_SKILLS);
        const userSkillsSet = new Set(userHabilidades.map(s => s.toLowerCase()));

        // Persiste o embedding do usuário para analytics/uso futuro.
        // O ranking NÃO usa este vetor — veja comentário abaixo.
        await this.computeAndStoreUserEmbedding(
            model, usuarioId, userTokens, normalizedExp, seniorityList
        );

        // Ranking via saída direta do modelo (probabilidade sigmoid de contratação).
        //
        // NÃO usamos cosine similarity entre emb_usuario e emb_vaga porque o
        // feature_projection_layer é uma camada discriminativa treinada sobre pares
        // completos (usuario+vaga). Embeddings individuais com metade do input zerado
        // ficam no mesmo octante ReLU, tornando as similaridades artificialmente
        // altas e indiferenciadas. A saída sigmoid do modelo completo é a métrica
        // correta para o objetivo pelo qual ele foi treinado.
        const resultados: VagaRecomendada[] = vagas.map(vaga => {
            const probabilidade = tf.tidy(() => {
                const jobHabilidades = vaga.habilidades ?? [];
                const jobTokens = vocabulary.tokenize(jobHabilidades, MAX_SKILLS);

                const oneHotSeniority = new Array(seniorityList.length).fill(0);
                const idx = seniorityList.indexOf(vaga.nivelSenioridade.toLowerCase());
                if (idx >= 0) oneHotSeniority[idx] = 1;

                const matchCount   = jobHabilidades.filter(s => userSkillsSet.has(s.toLowerCase())).length;
                const skillRecall   = matchCount / Math.max(jobHabilidades.length, 1);
                const skillCoverage = matchCount / Math.max(userHabilidades.length, 1);

                const userSkillsTensor = tf.tensor2d([userTokens],                                                          [1, MAX_SKILLS]);
                const jobSkillsTensor  = tf.tensor2d([jobTokens],                                                           [1, MAX_SKILLS]);
                const numericTensor    = tf.tensor2d([[normalizedExp, ...oneHotSeniority, skillRecall, skillCoverage]],     [1, 1 + seniorityList.length + 2]);

                const prediction = model.predict([userSkillsTensor, jobSkillsTensor, numericTensor]) as tf.Tensor;
                return prediction.dataSync()[0];
            });

            return { vaga, probabilidade };
        });

        return resultados
            .sort((a, b) => b.probabilidade - a.probabilidade)
            .slice(0, RECOMMENDATION_LIMIT);
    }

    private async computeAndStoreUserEmbedding(
        model: tf.LayersModel,
        usuarioId: string,
        userTokens: number[],
        normalizedExp: number,
        seniorityList: string[],
    ): Promise<void> {
        const extractor = tf.model({
            inputs: model.inputs,
            outputs: model.getLayer(FEATURE_PROJECTION_LAYER).output as tf.SymbolicTensor,
        });

        const embeddingVector = tf.tidy(() => {
            const zeroSeniority    = new Array(seniorityList.length).fill(0);
            const userSkillsTensor = tf.tensor2d([userTokens],                                    [1, MAX_SKILLS]);
            const jobSkillsTensor  = tf.zeros([1, MAX_SKILLS]);
            // overlap features são 0: sem vaga de referência para calcular sobreposição
            const numericTensor    = tf.tensor2d([[normalizedExp, ...zeroSeniority, 0, 0]],       [1, 1 + seniorityList.length + 2]);

            const embedding = extractor.predict([userSkillsTensor, jobSkillsTensor, numericTensor]) as tf.Tensor;
            return Array.from(embedding.dataSync());
        });

        await this.usuarioRepository.updateEmbeddings(usuarioId, embeddingVector);
    }
}
