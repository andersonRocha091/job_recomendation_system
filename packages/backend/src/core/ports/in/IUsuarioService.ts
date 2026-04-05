import { Usuario } from '../../domain/Usuario';

export interface IUsuarioService {
    listarUsuarios(): Promise<Usuario[]>;
    buscarPorId(id: string): Promise<Usuario | null>;
}
