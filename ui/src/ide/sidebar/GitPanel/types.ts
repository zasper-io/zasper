import { Commit } from '@/api';

/**
 * A commit placed on the graph. Purely a layout concern — `Commit` itself is the
 * server's shape and lives with the endpoint that returns it, in api/git.ts.
 */
export type CommitNode = {
  id: string;
  x: number;
  y: number;
  children: CommitNode[];
  commit: Commit;
};
