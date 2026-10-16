import { QuestionRepository } from '../ports/question_repository.js';
import { PassageRetriever, RetrievedPassage } from '../ports/passage_retriever.js';
import { Question } from '../../domain/types.js';

export interface ExplanationContext {
  question: Question;
  canonicalExplanation: string | null;
  passages: RetrievedPassage[];
  sourcePages: number[];
}

export class GetExplanationContext {
  private questionRepo: QuestionRepository;
  private passageRetriever: PassageRetriever;

  constructor(questionRepo: QuestionRepository, passageRetriever: PassageRetriever) {
    this.questionRepo = questionRepo;
    this.passageRetriever = passageRetriever;
  }

  public async execute(questionId: string): Promise<ExplanationContext> {
    const question = await this.questionRepo.getQuestionById(questionId);
    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }

    const passages = await this.passageRetriever.retrieveForQuestion(
      question.id,
      question.stem,
      3
    );

    const sourcePages = new Set<number>();
    if (question.sourcePage) {
      sourcePages.add(question.sourcePage);
    }
    for (const p of passages) {
      sourcePages.add(p.passage.startPage);
      if (p.passage.endPage && p.passage.endPage !== p.passage.startPage) {
        sourcePages.add(p.passage.endPage);
      }
    }

    return {
      question,
      canonicalExplanation: question.canonicalExplanation ?? null,
      passages,
      sourcePages: Array.from(sourcePages).sort((a, b) => a - b),
    };
  }
}

