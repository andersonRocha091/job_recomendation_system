import { Request, Response } from 'express';
import { IUsuarioService } from '../../../../core/ports/in/IUsuarioService';

export class UsuarioController {
    constructor(private readonly usuarioService: IUsuarioService) {}

    async listar(_req: Request, res: Response): Promise<void> {
        const usuarios = await this.usuarioService.listarUsuarios();
        res.json(usuarios);
    }

    async buscarPorId(req: Request, res: Response): Promise<void> {
        const usuario = await this.usuarioService.buscarPorId(req.params.id);
        if (!usuario) {
            res.status(404).json({ message: 'Usuário não encontrado' });
            return;
        }
        res.json(usuario);
    }
}
