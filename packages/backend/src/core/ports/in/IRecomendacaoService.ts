import { Vaga } from '@core/domain/Vaga';

export interface VagaRecomendada {
    vaga: Vaga;
    probabilidade: number;
}

export interface IRecomendacaoService {
    recomendar(usuarioId: string): Promise<VagaRecomendada[]>;
}
