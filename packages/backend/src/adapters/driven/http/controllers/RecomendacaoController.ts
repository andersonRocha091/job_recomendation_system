import { Request, Response } from 'express';
import { IRecomendacaoService } from '@core/ports/in/IRecomendacaoService';

export class RecomendacaoController {
    constructor(private readonly recomendacaoService: IRecomendacaoService) {}

    async recomendar(req: Request, res: Response): Promise<void> {
        try {
            const { usuarioId } = req.params;
            const recomendacoes = await this.recomendacaoService.recomendar(usuarioId);
            res.json(recomendacoes);
        } catch (err: any) {
            const status = err.message?.includes('não disponível') || err.message?.includes('não encontrado') ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }
}
