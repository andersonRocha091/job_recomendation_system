export interface Usuario {
    id: string;
    nome: string;
    email: string;
    areaAtuacao: string | null;
    estado: string | null;
    anosExperiencia: number | null;
    criadoEm: Date;
    habilidades?: string[];
}
