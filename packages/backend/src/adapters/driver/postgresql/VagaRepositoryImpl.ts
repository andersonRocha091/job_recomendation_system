import { Pool } from 'pg';
import { IVagaRepository } from '../../../core/ports/out/IVagaRepository';
import { Vaga } from '../../../core/domain/Vaga';

export class VagaRepositoryImpl implements IVagaRepository {
    constructor(private readonly pool: Pool) {}

    async findAll(): Promise<Vaga[]> {
        const { rows } = await this.pool.query<Vaga>(`
            SELECT
                v.id,
                v.titulo,
                v.empresa,
                v.estado,
                v.regime,
                v.nivel_senioridade                                                         AS "nivelSenioridade",
                v.salario_min                                                               AS "salarioMin",
                v.salario_max                                                               AS "salarioMax",
                v.publicada_em                                                              AS "publicadaEm",
                v.encerrada_em                                                              AS "encerradaEm",
                COALESCE(array_agg(DISTINCT hv.habilidade) FILTER (WHERE hv.habilidade IS NOT NULL), '{}') AS habilidades
            FROM vagas v
            LEFT JOIN habilidades_vaga hv ON hv.vaga_id = v.id
            WHERE v.encerrada_em IS NULL
            GROUP BY v.id
            ORDER BY v.publicada_em DESC
        `);
        return rows;
    }

    async findById(id: string): Promise<Vaga | null> {
        const { rows } = await this.pool.query<Vaga>(`
            SELECT
                v.id,
                v.titulo,
                v.empresa,
                v.estado,
                v.regime,
                v.nivel_senioridade                                                         AS "nivelSenioridade",
                v.salario_min                                                               AS "salarioMin",
                v.salario_max                                                               AS "salarioMax",
                v.publicada_em                                                              AS "publicadaEm",
                v.encerrada_em                                                              AS "encerradaEm",
                COALESCE(array_agg(DISTINCT hv.habilidade) FILTER (WHERE hv.habilidade IS NOT NULL), '{}') AS habilidades
            FROM vagas v
            LEFT JOIN habilidades_vaga hv ON hv.vaga_id = v.id
            WHERE v.id = $1
            GROUP BY v.id
        `, [id]);
        return rows[0] ?? null;
    }

    async updateEmbeddings(id: string, embeddings: number[]): Promise<void> {
        // pgvector espera o literal '[x,y,z]' (colchetes) — o driver pg serializa
        // number[] como '{x,y,z}' (chaves, formato de array PostgreSQL), que é
        // incompatível com o tipo vector e causaria erro de cast no banco.
        const vectorLiteral = `[${embeddings.join(',')}]`;
        await this.pool.query(`
            UPDATE vagas
            SET emb_vaga = $1
            WHERE id = $2
        `, [vectorLiteral, id]);
    }
}
