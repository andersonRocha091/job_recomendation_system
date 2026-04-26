import express, { Application } from 'express';

import { DatabaseConnection } from './adapters/driver/postgresql/DatabaseConnection';
import { VagaRepositoryImpl } from './adapters/driver/postgresql/VagaRepositoryImpl';
import { UsuarioRepositoryImpl } from './adapters/driver/postgresql/UsuarioRepositoryImpl';
import { TreinamentoRepository } from './adapters/driver/postgresql/TreinamentoRepository';

import { VagaService } from './core/usecases/VagaService';
import { UsuarioService } from './core/usecases/UsuarioService';
import { TrainService } from './core/domain/training/services/TrainService';
import { VocabularyService } from './core/domain/training/services/VocabularyService';

import { VagaController } from './adapters/driven/http/controllers/VagaController';
import { UsuarioController } from './adapters/driven/http/controllers/UsuarioController';
import { TreinamentoController } from './adapters/driven/http/controllers/TreinamentoController';
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
        const vagaRepository        = new VagaRepositoryImpl(pool);
        const usuarioRepository     = new UsuarioRepositoryImpl(pool);
        const treinamentoRepository = new TreinamentoRepository(pool);

        // core — use cases / domain services
        const vagaService    = new VagaService(vagaRepository);
        const usuarioService = new UsuarioService(usuarioRepository);
        const trainService   = new TrainService(treinamentoRepository, new VocabularyService(), vagaRepository);

        // driven — input adapters (HTTP)
        const vagaController        = new VagaController(vagaService);
        const usuarioController     = new UsuarioController(usuarioService);
        const treinamentoController = new TreinamentoController(trainService);

        const router = new Router(vagaController, usuarioController, treinamentoController);
        this.app.use('/api', router.getRouter());
    }

    public getApp(): Application {
        return this.app;
    }
}
