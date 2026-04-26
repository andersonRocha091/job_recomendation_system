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

    async findByIdComHabilidades(id: string): Promise<Usuario | null> {
        const { rows } = await this.pool.query<Usuario>(`
            SELECT
                u.id,
                u.nome,
                u.email,
                u.area_atuacao      AS "areaAtuacao",
                u.estado,
                u.anos_experiencia  AS "anosExperiencia",
                u.criado_em         AS "criadoEm",
                COALESCE(array_agg(DISTINCT hu.habilidade) FILTER (WHERE hu.habilidade IS NOT NULL), '{}') AS habilidades
            FROM usuarios u
            LEFT JOIN habilidades_usuario hu ON hu.usuario_id = u.id
            WHERE u.id = $1
            GROUP BY u.id
        `, [id]);
        return rows[0] ?? null;
    }

    async updateEmbeddings(id: string, embeddings: number[]): Promise<void> {
        const vectorLiteral = `[${embeddings.join(',')}]`;
        await this.pool.query(`
            UPDATE usuarios
            SET emb_usuario = $1, emb_atualizado_em = NOW()
            WHERE id = $2
        `, [vectorLiteral, id]);
    }
}
