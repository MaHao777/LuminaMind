import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type Props = {
  children: string;
  className?: string;
};

function normalizeLatexDelimiters(markdown: string) {
  let fenceMarker = "";
  let fenceLength = 0;

  return markdown
    .split("\n")
    .map((line) => {
      const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1][0];
        if (!fenceMarker) {
          fenceMarker = marker;
          fenceLength = fence[1].length;
        } else if (marker === fenceMarker && fence[1].length >= fenceLength) {
          fenceMarker = "";
          fenceLength = 0;
        }
        return line;
      }
      if (fenceMarker) return line;

      let codeTicks = 0;
      let output = "";
      for (let index = 0; index < line.length;) {
        if (line[index] === "`") {
          let runLength = 1;
          while (line[index + runLength] === "`") runLength += 1;
          if (codeTicks === 0) codeTicks = runLength;
          else if (codeTicks === runLength) codeTicks = 0;
          output += line.slice(index, index + runLength);
          index += runLength;
        } else if (codeTicks === 0 && line.startsWith("\\[", index)) {
          output += "$$";
          index += 2;
        } else if (codeTicks === 0 && line.startsWith("\\]", index)) {
          output += "$$";
          index += 2;
        } else if (codeTicks === 0 && line.startsWith("\\(", index)) {
          output += "$";
          index += 2;
        } else if (codeTicks === 0 && line.startsWith("\\)", index)) {
          output += "$";
          index += 2;
        } else {
          output += line[index];
          index += 1;
        }
      }
      return output;
    })
    .join("\n");
}

export function MarkdownContent({ children, className = "markdown-content" }: Props) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
      >
        {normalizeLatexDelimiters(children)}
      </ReactMarkdown>
    </div>
  );
}
