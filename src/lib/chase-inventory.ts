// The chase screen's inventory, with each question shipped ONCE (audit F13,
// 2026-11-06).
//
// `groupByContact` gives every colleague (`role = 'internal'`) a group holding
// EVERY outstanding question on the project, which is right for the screen and
// was ruinous on the wire: `GET /api/drafts` serialised each group's questions
// in full, so each colleague added the whole project again. Measured on a
// 440-record synthetic project: 19,715 questions, 62.9 MB of JSON with one
// designer and two colleagues.
//
// Packed, the response carries the questions once, in the order they first
// appear, and each group names its questions by POSITION in that list. The
// screen unpacks to the same `{ contact, questions }[]` it always read, holding
// references to one object per question. A leaf: no database, so the pure tier
// tests both halves and the browser can import it.

type QuestionLike = { recordId: string; requirementId: string };

export type PackedContactGroups<C, Q> = {
  questions: Q[];
  groups: { contact: C; questionIndexes: number[] }[];
};

export function packContactGroups<C, Q extends QuestionLike>(
  groups: { contact: C; questions: Q[] }[],
): PackedContactGroups<C, Q> {
  const questions: Q[] = [];
  const position = new Map<string, number>();
  const packed = groups.map((group) => ({
    contact: group.contact,
    questionIndexes: group.questions.map((question) => {
      // The question's identity is its record and requirement, the same two
      // parts `questionKey` uses at revision 0, never the object itself: a
      // caller that copied a question (adding `waiting`, say) must still pack
      // to one entry.
      const key = `${question.recordId}\u0000${question.requirementId}`;
      let index = position.get(key);
      if (index === undefined) {
        index = questions.length;
        position.set(key, index);
        questions.push(question);
      }
      return index;
    }),
  }));
  return { questions, groups: packed };
}

export function unpackContactGroups<C, Q>(packed: PackedContactGroups<C, Q>): { contact: C; questions: Q[] }[] {
  return packed.groups.map((group) => ({
    contact: group.contact,
    questions: group.questionIndexes.map((index) => {
      const question = packed.questions[index];
      // A position that names nothing is a broken response, and an undefined
      // row would render as a question about nothing.
      if (question === undefined) throw new Error(`The chase inventory names question ${index}, which it does not carry.`);
      return question;
    }),
  }));
}
