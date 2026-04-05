import express, { Application } from 'express';

import { DatabaseConnection } from './adapters/driver/postgresql/DatabaseConnection';
import { VagaRepositoryImpl } from './adapters/driver/postgresql/VagaRepositoryImpl';
import { UsuarioRepositoryImpl } from './adapters/driver/postgresql/UsuarioRepositoryImpl';

import { VagaService } from './core/usecases/VagaService';
import { UsuarioService } from './core/usecases/UsuarioService';

import { VagaController } from './adapters/driven/http/controllers/VagaController';
import { UsuarioController } from './adapters/driven/http/controllers/UsuarioController';
import { Router } from './adapters/driven/http/Router';

export class App {
    private readonly app: Application;

    constructor() {
        this.app = express();
        this.configure();
        this.registerRoutes();
    }

    private configure(): void {
        this.app.use(express.json());
    }

    private registerRoutes(): void {
        const pool = DatabaseConnection.getInstance().getPool();

        // driver — output adapters (PostgreSQL)
        const vagaRepository    = new VagaRepositoryImpl(pool);
        const usuarioRepository = new UsuarioRepositoryImpl(pool);

        // core — use cases
        const vagaService    = new VagaService(vagaRepository);
        const usuarioService = new UsuarioService(usuarioRepository);

        // driven — input adapters (HTTP)
        const vagaController    = new VagaController(vagaService);
        const usuarioController = new UsuarioController(usuarioService);

        const router = new Router(vagaController, usuarioController);
        this.app.use('/api', router.getRouter());
    }

    public getApp(): Application {
        return this.app;
    }
}
