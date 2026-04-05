import { TrainingRowMapper, RawTrainingRow } from '@adapters/driver/postgresql/TrainingRowMapper';
import { TrainingRow } from '@core/domain/training/TrainingRow';

const makeRaw = (overrides: Partial<RawTrainingRow> = {}): RawTrainingRow => ({
    anos_experiencia: 4,
    habilidades_usuario: ['Node.js', 'TypeScript'],
    nivel_senioridade: 'pleno',
    habilidades_vagas: ['Node.js', 'AWS'],
    contratado: 0,
    ...overrides,
});

const makeModel = (overrides: Partial<TrainingRow> = {}): TrainingRow => ({
    anosExperiencia: 4,
    skillsUsuario: ['Node.js', 'TypeScript'],
    nivelSenioridade: 'pleno',
    skillsVaga: ['Node.js', 'AWS'],
    contratado: 0,
    ...overrides,
});

describe('TrainingRowMapper', () => {
    describe('toModel()', () => {
        it('mapeia todos os campos do shape do banco para o modelo de domínio', () => {
            const raw = makeRaw();

            const model = TrainingRowMapper.toModel(raw);

            expect(model).toEqual({
                anosExperiencia: 4,
                skillsUsuario: ['Node.js', 'TypeScript'],
                nivelSenioridade: 'pleno',
                skillsVaga: ['Node.js', 'AWS'],
                contratado: 0,
            });
        });

        it('preserva contratado=1 (candidato contratado)', () => {
            const model = TrainingRowMapper.toModel(makeRaw({ contratado: 1 }));

            expect(model.contratado).toBe(1);
        });

        it('preserva contratado=0 (candidato não contratado)', () => {
            const model = TrainingRowMapper.toModel(makeRaw({ contratado: 0 }));

            expect(model.contratado).toBe(0);
        });

        it('preserva os arrays de habilidades sem modificação', () => {
            const habilidades_usuario = ['React', 'Redux', 'TypeScript'];
            const habilidades_vagas   = ['React', 'GraphQL'];

            const model = TrainingRowMapper.toModel(makeRaw({ habilidades_usuario, habilidades_vagas }));

            expect(model.skillsUsuario).toEqual(habilidades_usuario);
            expect(model.skillsVaga).toEqual(habilidades_vagas);
        });

        it('mapeia corretamente diferentes níveis de senioridade', () => {
            const niveis = ['junior', 'pleno', 'senior'];

            niveis.forEach(nivel => {
                const model = TrainingRowMapper.toModel(makeRaw({ nivel_senioridade: nivel }));
                expect(model.nivelSenioridade).toBe(nivel);
            });
        });

        it('renomeia campos snake_case do banco para camelCase do domínio', () => {
            const model = TrainingRowMapper.toModel(makeRaw({ anos_experiencia: 7 }));

            expect((model as any).anos_experiencia).toBeUndefined();
            expect(model.anosExperiencia).toBe(7);
        });
    });

    describe('toDto()', () => {
        it('mapeia todos os campos do modelo de domínio para o DTO', () => {
            const model = makeModel();

            const dto = TrainingRowMapper.toDto(model);

            expect(dto).toEqual({
                anosExperiencia: 4,
                skillsUsuario: ['Node.js', 'TypeScript'],
                nivelSenioridade: 'pleno',
                skillsVaga: ['Node.js', 'AWS'],
                contratado: 0,
            });
        });

        it('preserva contratado=1 no DTO', () => {
            const dto = TrainingRowMapper.toDto(makeModel({ contratado: 1 }));

            expect(dto.contratado).toBe(1);
        });

        it('preserva contratado=0 no DTO', () => {
            const dto = TrainingRowMapper.toDto(makeModel({ contratado: 0 }));

            expect(dto.contratado).toBe(0);
        });

        it('preserva os arrays de skills sem modificação', () => {
            const skillsUsuario = ['Python', 'Django', 'PostgreSQL'];
            const skillsVaga    = ['Python', 'FastAPI', 'Docker'];

            const dto = TrainingRowMapper.toDto(makeModel({ skillsUsuario, skillsVaga }));

            expect(dto.skillsUsuario).toEqual(skillsUsuario);
            expect(dto.skillsVaga).toEqual(skillsVaga);
        });
    });

    describe('round-trip toModel → toDto', () => {
        it('domínio convertido para DTO mantém todos os dados íntegros', () => {
            const raw = makeRaw({ anos_experiencia: 6, contratado: 1, nivel_senioridade: 'senior' });

            const dto = TrainingRowMapper.toDto(TrainingRowMapper.toModel(raw));

            expect(dto).toEqual({
                anosExperiencia: 6,
                skillsUsuario: raw.habilidades_usuario,
                nivelSenioridade: 'senior',
                skillsVaga: raw.habilidades_vagas,
                contratado: 1,
            });
        });
    });
});
