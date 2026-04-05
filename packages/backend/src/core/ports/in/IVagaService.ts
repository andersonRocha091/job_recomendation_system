import { Vaga } from '../../domain/Vaga';

export interface IVagaService {
    listarVagas(): Promise<Vaga[]>;
    buscarPorId(id: string): Promise<Vaga | null>;
}
