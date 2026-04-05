import { Request, Response } from 'express';
import { IVagaService } from '../../../../core/ports/in/IVagaService';

export class VagaController {
    constructor(private readonly vagaService: IVagaService) {}

    async listar(_req: Request, res: Response): Promise<void> {
        const vagas = await this.vagaService.listarVagas();
        res.json(vagas);
    }

    async buscarPorId(req: Request, res: Response): Promise<void> {
        const vaga = await this.vagaService.buscarPorId(req.params.id);
        if (!vaga) {
            res.status(404).json({ message: 'Vaga não encontrada' });
            return;
        }
        res.json(vaga);
    }
}
