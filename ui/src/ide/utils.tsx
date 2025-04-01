export default function getFileExtension(filename: string): string | null {
  const parts = filename.split('.');
  if (parts.length > 1) {
    return parts.pop() || null;
  }
  return null;
}

export const getIconToLoad = (fileName) => {
  const extension = getFileExtension(fileName);
  const iconMap: { [key: string]: string } = {
    c: './images/editor/c-icon.svg',
    cpp: './images/editor/cpp-icon.svg',
    go: './images/editor/go-icon.svg',
    mod: './images/editor/go-icon.svg',
    sum: './images/editor/go-icon.svg',
    py: './images/editor/py-icon.svg',
    ipynb: './images/editor/jupyter-icon.svg',
    java: './images/editor/java-icon.svg',
    class: './images/editor/java-icon.svg',
    js: './images/editor/js-icon.svg',
    json: './images/editor/json-icon.svg',
    png: './images/editor/image-icon.svg',
    ts: './images/editor/ts-icon.svg',
    tsx: './images/editor/react-icon.svg',
    jsx: './images/editor/react-icon.svg',
    html: './images/editor/html-icon.svg',
    css: './images/editor/go-icon.svg',
    sass: './images/editor/go-icon.svg',
    scss: './images/editor/go-icon.svg',
    svg: './images/editor/image-icon.svg',
    md: './images/editor/md-icon.svg',
    markdown: './images/editor/md-icon.svg',
    txt: './images/editor/txt-icon.svg',
    gitignore: './images/editor/git-icon.svg',
  };
  const icon = extension != null ? iconMap[extension] : './images/editor/unknown-file-icon.svg';
  return icon != null ? icon : './images/editor/unknown-file-icon.svg';
};
