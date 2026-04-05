import { Pool } from 'pg';
import { IUsuarioRepository } from '../../../core/ports/out/IUsuarioRepository';
import { Usuario } from '../../../core/domain/Usuario';

export class UsuarioRepositoryImpl implements IUsuarioRepository {
    constructor(private readonly pool: Pool) {}

    async findAll(): Promise<Usuario[]> {
        const { rows } = await this.pool.query<Usuario>(`
            SELECT
                id,
                nome,
                email,
                area_atuacao        AS "areaAtuacao",
                estado,
                anos_experiencia    AS "anosExperiencia",
                criado_em           AS "criadoEm"
            FROM usuarios
            ORDER BY criado_em DESC
        `);
        return rows;
    }

    async findById(id: string): Promise<Usuario | null> {
        const { rows } = await this.pool.query<Usuario>(`
            SELECT
                id,
                nome,
                email,
                area_atuacao        AS "areaAtuacao",
                estado,
                anos_experiencia    AS "anosExperiencia",
                criado_em           AS "criadoEm"
            FROM usuarios WHERE id = $1
        `, [id]);
        return rows[0] ?? null;
    }
}
