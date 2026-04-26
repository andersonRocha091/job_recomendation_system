import { Request, Response } from 'express';
import { ITreinamentoService } from '../../../../core/ports/in/ITreinamentoService';

export class TreinamentoController {
    constructor(private readonly treinamentoService: ITreinamentoService) {}

    async executar(_req: Request, res: Response): Promise<void> {
        try {
            await this.treinamentoService.executarTreinamento();
            res.status(200).json({ message: 'Treinamento concluído com sucesso.' });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Erro desconhecido durante o treinamento.';
            res.status(500).json({ message });
        }
    }
}
