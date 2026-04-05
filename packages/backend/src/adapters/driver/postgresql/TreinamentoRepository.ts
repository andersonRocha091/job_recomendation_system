import { Pool } from 'pg';
import { TrainingRow } from '@core/domain/training/TrainingRow';
import { ITreinamentoRepository } from '@core/ports/out/ITreinamentoRepository';
import { RawTrainingRow, TrainingRowMapper } from './TrainingRowMapper';

export class TreinamentoRepository implements ITreinamentoRepository {

    constructor(private readonly pool: Pool) {}

    async getRawTrainingData(): Promise<TrainingRow[]> {
        const query = `
            SELECT
            u.anos_experiencia,
            array_agg(distinct hu.habilidade) as habilidades_usuario,
            v.nivel_senioridade,
            array_agg(distinct hv.habilidade) as habilidades_vagas,
            MAX(case when c.status = 'contratado' then 1 else 0 end) as contratado
            FROM usuarios u
            JOIN  habilidades_usuario hu on (hu.usuario_id = u.id)
            CROSS JOIN vagas v
            JOIN habilidades_vaga hv on (hv.vaga_id = v.id)
            LEFT JOIN candidaturas c on (c.usuario_id = u.id and c.vaga_id = v.id)
            GROUP BY u.id, v.id, v.nivel_senioridade
        `;
        const res = await this.pool.query(query);
        return (res.rows as RawTrainingRow[]).map(TrainingRowMapper.toModel);
    }

}
