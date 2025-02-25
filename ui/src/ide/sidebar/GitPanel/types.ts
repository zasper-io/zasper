export type Commit = {
  hash: string;
  message: string;
  author: string;
  date: string;
  branch: string;
  parents: string[];
};

export type CommitNode = {
  id: string;
  x: number;
  y: number;
  children: CommitNode[];
  commit: Commit;
};
