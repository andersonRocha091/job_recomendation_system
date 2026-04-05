import { TrainingRow } from '../TrainingRow';

export class VocabularyService {
    private vocabulary: Map<string, number> = new Map();

    build(rows: TrainingRow[]) {
        const allSkills = new Set<string>();
        rows.forEach(row => {
            row.skillsUsuario.forEach((skill: string) => allSkills.add(skill));
            row.skillsVaga.forEach((skill: string) => allSkills.add(skill));
        });

        Array.from(allSkills).forEach((skill, index) => {
            // we will start indexing from 1, leaving 0 for 'padding'
            this.vocabulary.set(skill, index + 1);
        });
    }

    tokenize(skills: string[], maxLength: number): number[] {
        const tokens = skills.map(skill => this.vocabulary.get(skill) || 0); // use 0 for unknown skills
        // Adjusting size (Padding) in order to ensure all tensors are of the same size
        if (tokens.length > maxLength) return tokens.slice(0, maxLength);
        return [...tokens, ...new Array(maxLength - tokens.length).fill(0)];
    }

    size(): number {
        return this.vocabulary.size;
    }
}
