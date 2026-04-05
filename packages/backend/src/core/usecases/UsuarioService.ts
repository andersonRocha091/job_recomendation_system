import { IUsuarioService } from '../ports/in/IUsuarioService';
import { IUsuarioRepository } from '../ports/out/IUsuarioRepository';
import { Usuario } from '../domain/Usuario';

export class UsuarioService implements IUsuarioService {
    constructor(private readonly repository: IUsuarioRepository) {}

    async listarUsuarios(): Promise<Usuario[]> {
        return this.repository.findAll();
    }

    async buscarPorId(id: string): Promise<Usuario | null> {
        return this.repository.findById(id);
    }
}
