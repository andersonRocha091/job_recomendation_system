import { Router as ExpressRouter, Request, Response } from 'express';
import { VagaController } from './controllers/VagaController';
import { UsuarioController } from './controllers/UsuarioController';

export class Router {
    private readonly router: ExpressRouter;

    constructor(
        private readonly vagaController: VagaController,
        private readonly usuarioController: UsuarioController,
    ) {
        this.router = ExpressRouter();
        this.registerRoutes();
    }

    private registerRoutes(): void {
        this.router.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));

        this.router.get('/vagas', (req, res) => this.vagaController.listar(req, res));
        this.router.get('/vagas/:id', (req, res) => this.vagaController.buscarPorId(req, res));

        this.router.get('/usuarios', (req, res) => this.usuarioController.listar(req, res));
        this.router.get('/usuarios/:id', (req, res) => this.usuarioController.buscarPorId(req, res));
    }

    public getRouter(): ExpressRouter {
        return this.router;
    }
}
