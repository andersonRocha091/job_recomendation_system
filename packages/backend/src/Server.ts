import { App } from './App';

export class Server {
    private readonly port: number;
    private readonly app: App;

    constructor() {
        this.port = Number(process.env.PORT) || 3001;
        this.app = new App();
    }

    public async start(): Promise<void> {
        await this.app.initialize();
        this.app.getApp().listen(this.port, () => {
            console.log(`Backend running on http://localhost:${this.port}`);
        });
    }
}
