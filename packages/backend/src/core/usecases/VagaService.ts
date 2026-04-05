import { IVagaService } from '../ports/in/IVagaService';
import { IVagaRepository } from '../ports/out/IVagaRepository';
import { Vaga } from '../domain/Vaga';

export class VagaService implements IVagaService {
    constructor(private readonly repository: IVagaRepository) {}

    async listarVagas(): Promise<Vaga[]> {
        return this.repository.findAll();
    }

    async buscarPorId(id: string): Promise<Vaga | null> {
        return this.repository.findById(id);
    }
}
