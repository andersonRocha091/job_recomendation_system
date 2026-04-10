export interface Vaga {
    id: string;
    titulo: string;
    empresa: string;
    estado: string | null;
    regime: string;
    nivelSenioridade: string;
    salarioMin: number | null;
    salarioMax: number | null;
    publicadaEm: Date;
    encerradaEm: Date | null;
    habilidades?: string[]; // skills da vaga — populadas via JOIN com habilidades_vaga
}
