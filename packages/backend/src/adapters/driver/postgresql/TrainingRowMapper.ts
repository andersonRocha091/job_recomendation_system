import { TrainingRow } from '@core/domain/training/TrainingRow';
import { TrainingRowDto } from '@core/domain/training/TrainingRowDto';

/** Shape retornado diretamente pelo banco de dados. */
export interface RawTrainingRow {
    anos_experiencia: number;
    habilidades_usuario: string[];
    nivel_senioridade: string;
    habilidades_vagas: string[];
    contratado: number; // 0 | 1 — resultado do MAX(CASE ...) no SQL
}

export class TrainingRowMapper {
    /** Converte a linha crua do banco para o modelo de domínio. */
    static toModel(raw: RawTrainingRow): TrainingRow {
        return {
            anosExperiencia: raw.anos_experiencia,
            skillsUsuario: raw.habilidades_usuario,
            nivelSenioridade: raw.nivel_senioridade,
            skillsVaga: raw.habilidades_vagas,
            contratado: raw.contratado,
        };
    }

    /** Converte o modelo de domínio para o DTO de transporte (ex.: resposta HTTP). */
    static toDto(model: TrainingRow): TrainingRowDto {
        return {
            anosExperiencia: model.anosExperiencia,
            skillsUsuario: model.skillsUsuario,
            nivelSenioridade: model.nivelSenioridade,
            skillsVaga: model.skillsVaga,
            contratado: model.contratado,
        };
    }
}
