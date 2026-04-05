import { VocabularyService } from '@core/domain/training/services/VocabularyService';
import { TrainingRow } from '@core/domain/training/TrainingRow';

const makeRow = (skillsUsuario: string[], skillsVaga: string[]): TrainingRow => ({
    anosExperiencia: 3,
    skillsUsuario,
    nivelSenioridade: 'pleno',
    skillsVaga,
    contratado: 0,
});

describe('VocabularyService', () => {
    let service: VocabularyService;

    beforeEach(() => {
        service = new VocabularyService();
    });

    // -------------------------------------------------------------------------
    describe('size()', () => {
        it('retorna 0 antes de qualquer build', () => {
            expect(service.size()).toBe(0);
        });

        it('retorna o total de skills únicas após o build', () => {
            service.build([
                makeRow(['Node.js', 'TypeScript'], ['Node.js', 'AWS']),
            ]);
            // Node.js (duplicado), TypeScript, AWS → 3 únicas
            expect(service.size()).toBe(3);
        });
    });

    // -------------------------------------------------------------------------
    describe('build()', () => {
        it('indexa skills a partir de 1, reservando 0 para padding', () => {
            service.build([makeRow(['Python'], ['FastAPI'])]);

            const tokens = service.tokenize(['Python', 'FastAPI'], 2);
            expect(tokens.every(t => t >= 1)).toBe(true);
        });

        it('desduplicação: mesma skill em skillsUsuario e skillsVaga conta uma só vez', () => {
            service.build([makeRow(['React'], ['React', 'Redux'])]);

            // React (dup) + Redux → 2 únicas
            expect(service.size()).toBe(2);
        });

        it('desduplicação: mesma skill em linhas diferentes conta uma só vez', () => {
            service.build([
                makeRow(['Java'], ['Spring Boot']),
                makeRow(['Java'], ['Kubernetes']),
            ]);
            // Java (dup), Spring Boot, Kubernetes → 3 únicas
            expect(service.size()).toBe(3);
        });

        it('constrói vocabulário completo a partir de múltiplas linhas de treinamento', () => {
            const rows = [
                makeRow(['Node.js', 'TypeScript'], ['Node.js', 'AWS', 'Docker']),
                makeRow(['Python', 'Django'],       ['Python', 'FastAPI']),
            ];
            service.build(rows);
            // Node.js(dup), TypeScript, AWS, Docker, Python(dup), Django, FastAPI → 7 únicas
            expect(service.size()).toBe(7);
        });

        it('aceita linhas com arrays de skills vazios sem erros', () => {
            expect(() => service.build([makeRow([], [])])).not.toThrow();
            expect(service.size()).toBe(0);
        });

        it('aceita array de linhas vazio sem erros', () => {
            expect(() => service.build([])).not.toThrow();
            expect(service.size()).toBe(0);
        });

        it('acumula o vocabulário entre chamadas sucessivas de build (comportamento atual)', () => {
            // ATENÇÃO: build() não reinicia o vocabulário entre chamadas — ele acumula.
            // Em cenários de retreinamento do modelo, é necessário instanciar um novo
            // VocabularyService ou adicionar um método reset() para evitar contaminação
            // de dados entre sessões de treinamento distintas.
            service.build([makeRow(['Java'], ['Spring'])]);
            expect(service.size()).toBe(2);

            service.build([makeRow(['Go'], ['gRPC', 'Protobuf'])]);
            // Java e Spring do primeiro build permanecem → 2 + 3 = 5
            expect(service.size()).toBe(5);

            // Skills do primeiro build ainda são reconhecidas
            const tokens = service.tokenize(['Java'], 1);
            expect(tokens[0]).toBeGreaterThanOrEqual(1);
        });
    });

    // -------------------------------------------------------------------------
    describe('tokenize()', () => {
        beforeEach(() => {
            service.build([
                makeRow(['Node.js', 'TypeScript', 'PostgreSQL'], ['Node.js', 'AWS', 'Docker']),
            ]);
            // Vocabulário: Node.js=1, TypeScript=2, PostgreSQL=3, AWS=4, Docker=5
        });

        it('converte skills conhecidas para seus índices numéricos', () => {
            const tokens = service.tokenize(['TypeScript', 'AWS'], 2);
            expect(tokens).toHaveLength(2);
            expect(tokens.every(t => t >= 1)).toBe(true);
        });

        it('usa 0 para skills desconhecidas (fora do vocabulário)', () => {
            const tokens = service.tokenize(['Rust', 'Haskell'], 2);
            expect(tokens).toEqual([0, 0]);
        });

        it('combina skills conhecidas e desconhecidas na mesma sequência', () => {
            const tokens = service.tokenize(['Node.js', 'Rust'], 2);
            expect(tokens[0]).toBeGreaterThanOrEqual(1); // Node.js é conhecida
            expect(tokens[1]).toBe(0);                   // Rust é desconhecida
        });

        it('trunca quando a quantidade de skills excede maxLength', () => {
            const tokens = service.tokenize(['Node.js', 'TypeScript', 'PostgreSQL', 'AWS', 'Docker'], 3);
            expect(tokens).toHaveLength(3);
        });

        it('aplica padding com zeros quando skills são menos que maxLength', () => {
            const tokens = service.tokenize(['Node.js'], 4);
            expect(tokens).toHaveLength(4);
            expect(tokens[1]).toBe(0);
            expect(tokens[2]).toBe(0);
            expect(tokens[3]).toBe(0);
        });

        it('retorna vetor de zeros (só padding) quando skills está vazio', () => {
            const tokens = service.tokenize([], 3);
            expect(tokens).toEqual([0, 0, 0]);
        });

        it('retorna vetor vazio quando maxLength é 0', () => {
            const tokens = service.tokenize(['Node.js', 'TypeScript'], 0);
            expect(tokens).toEqual([]);
        });

        it('garante que todos os vetores têm o mesmo tamanho independente do input (invariante para tensores)', () => {
            const maxLength = 5;
            const inputs = [
                [],
                ['Node.js'],
                ['Node.js', 'TypeScript', 'PostgreSQL', 'AWS', 'Docker'],
                ['Node.js', 'TypeScript', 'PostgreSQL', 'AWS', 'Docker', 'Rust'],
            ];
            inputs.forEach(skills => {
                expect(service.tokenize(skills, maxLength)).toHaveLength(maxLength);
            });
        });
    });
});
