import { Pool } from 'pg';
import { IVagaRepository } from '../../../core/ports/out/IVagaRepository';
import { Vaga } from '../../../core/domain/Vaga';

export class VagaRepositoryImpl implements IVagaRepository {
    constructor(private readonly pool: Pool) {}

    async findAll(): Promise<Vaga[]> {
        const { rows } = await this.pool.query<Vaga>(`
            SELECT
                id,
                titulo,
                empresa,
                estado,
                regime,
                nivel_senioridade   AS "nivelSenioridade",
                salario_min         AS "salarioMin",
                salario_max         AS "salarioMax",
                publicada_em        AS "publicadaEm",
                encerrada_em        AS "encerradaEm"
            FROM vagas
            WHERE encerrada_em IS NULL
            ORDER BY publicada_em DESC
        `);
        return rows;
    }

    async findById(id: string): Promise<Vaga | null> {
        const { rows } = await this.pool.query<Vaga>(`
            SELECT
                id,
                titulo,
                empresa,
                estado,
                regime,
                nivel_senioridade   AS "nivelSenioridade",
                salario_min         AS "salarioMin",
                salario_max         AS "salarioMax",
                publicada_em        AS "publicadaEm",
                encerrada_em        AS "encerradaEm"
            FROM vagas WHERE id = $1
        `, [id]);
        return rows[0] ?? null;
    }
}
