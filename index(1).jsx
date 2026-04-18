import { useState, useRef, useEffect } from "react";

// ============================================================
// AICELS - AI Code Evaluator and Learning System
// W3C AIKR CG / Epistemic Systems Lab
// Bug fix: empty input no longer returns grade A
// Enhancement: quality analysis decoupled from execution
// ============================================================

// --- Code Evaluator Engine (runs entirely client-side via AST simulation) ---

function countIndentLevels(code) {
  let maxDepth = 0;
  const lines = code.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const stripped = line.replace(/\t/g, "    ");
    const indent = stripped.length - stripped.trimStart().length;
    const depth = Math.floor(indent / 4);
    if (depth > maxDepth) maxDepth = depth;
  }
  return maxDepth;
}

function analyzeCode(code) {
  const issues = [];
  const strengths = [];
  const lines = code.split("\n");
  const nonEmptyLines = lines.filter((l) => l.trim() !== "");

  // --- SYNTAX CHECK ---
  let syntaxValid = true;
  let syntaxError = null;
  // Basic bracket/paren/brace matching
  const stack = [];
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const closing = new Set([")", "]", "}"]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // skip strings roughly
    const stripped = line.replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, "");
    // skip comments
    const noComment = stripped.replace(/#.*$/, "");
    for (const ch of noComment) {
      if (pairs[ch]) stack.push({ ch, close: pairs[ch], line: i + 1 });
      if (closing.has(ch)) {
        if (stack.length === 0 || stack[stack.length - 1].close !== ch) {
          syntaxValid = false;
          syntaxError = `Mismatched '${ch}' at line ${i + 1}`;
          break;
        }
        stack.pop();
      }
    }
    if (!syntaxValid) break;
  }
  if (syntaxValid && stack.length > 0) {
    syntaxValid = false;
    syntaxError = `Unclosed '${stack[stack.length - 1].ch}' from line ${stack[stack.length - 1].line}`;
  }

  // --- FUNCTION DETECTION ---
  const funcPattern = /^(\s*)def\s+(\w+)\s*\(/;
  const classPattern = /^(\s*)class\s+(\w+)/;
  const functions = [];
  const classes = [];

  for (let i = 0; i < lines.length; i++) {
    const funcMatch = lines[i].match(funcPattern);
    if (funcMatch) {
      // Count function length (until next same-indent def/class or end)
      const indent = funcMatch[1].length;
      let end = i + 1;
      while (end < lines.length) {
        const nextLine = lines[end];
        if (nextLine.trim() === "") { end++; continue; }
        const nextIndent = nextLine.length - nextLine.trimStart().length;
        if (nextIndent <= indent && nextLine.trim() !== "") break;
        end++;
      }
      functions.push({
        name: funcMatch[2],
        startLine: i,
        endLine: end,
        length: end - i,
        hasDocstring: (i + 1 < lines.length && /^\s*("""|''')/.test(lines[i + 1])),
        hasTypeHints: /->/.test(lines[i]),
        hasParamHints: /:\s*\w+/.test(lines[i].replace(/def\s+\w+\s*\(/, "")),
      });
    }
    const classMatch = lines[i].match(classPattern);
    if (classMatch) {
      classes.push({ name: classMatch[2], line: i });
    }
  }

  // --- NAMING CONVENTIONS ---
  for (const fn of functions) {
    if (fn.name !== fn.name.toLowerCase() && fn.name.includes("_") === false) {
      // camelCase function
      if (/[A-Z]/.test(fn.name[0])) {
        issues.push({
          type: "naming",
          severity: "warning",
          message: `Function '${fn.name}' uses PascalCase -- PEP 8 recommends snake_case`,
          line: fn.startLine + 1,
        });
      } else if (/[A-Z]/.test(fn.name)) {
        issues.push({
          type: "naming",
          severity: "info",
          message: `Function '${fn.name}' uses camelCase -- PEP 8 recommends snake_case`,
          line: fn.startLine + 1,
        });
      }
    }
  }
  for (const cls of classes) {
    if (cls.name !== cls.name[0].toUpperCase() + cls.name.slice(1) || cls.name.includes("_")) {
      issues.push({
        type: "naming",
        severity: "warning",
        message: `Class '${cls.name}' does not use PascalCase`,
        line: cls.line + 1,
      });
    }
  }

  // --- DOCUMENTATION ---
  const documentedFuncs = functions.filter((f) => f.hasDocstring).length;
  if (functions.length > 0) {
    const ratio = documentedFuncs / functions.length;
    if (ratio === 1) {
      strengths.push("All functions have docstrings");
    } else if (ratio >= 0.5) {
      issues.push({
        type: "documentation",
        severity: "info",
        message: `${functions.length - documentedFuncs} of ${functions.length} functions lack docstrings`,
      });
    } else if (ratio > 0) {
      issues.push({
        type: "documentation",
        severity: "warning",
        message: `Only ${documentedFuncs} of ${functions.length} functions have docstrings`,
      });
    } else {
      issues.push({
        type: "documentation",
        severity: "warning",
        message: `No functions have docstrings`,
      });
    }
  }

  // --- FUNCTION LENGTH ---
  for (const fn of functions) {
    if (fn.length > 50) {
      issues.push({
        type: "structure",
        severity: "warning",
        message: `Function '${fn.name}' is ${fn.length} lines long -- consider refactoring (>50 lines)`,
        line: fn.startLine + 1,
      });
    } else if (fn.length > 30) {
      issues.push({
        type: "structure",
        severity: "info",
        message: `Function '${fn.name}' is ${fn.length} lines -- getting long`,
        line: fn.startLine + 1,
      });
    }
  }

  // --- TYPE HINTS ---
  if (functions.length > 0) {
    const hinted = functions.filter((f) => f.hasTypeHints).length;
    if (hinted === 0 && functions.length >= 2) {
      issues.push({
        type: "type_hints",
        severity: "info",
        message: "No functions use return type hints -- consider adding type annotations",
      });
    } else if (hinted === functions.length) {
      strengths.push("All functions have return type hints");
    }
  }

  // --- BARE EXCEPTS ---
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*except\s*:/.test(lines[i])) {
      issues.push({
        type: "code_smell",
        severity: "warning",
        message: "Bare 'except:' catches all exceptions including SystemExit and KeyboardInterrupt",
        line: i + 1,
      });
    }
  }

  // --- GLOBAL VARIABLES ---
  let globalAssignments = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    // Top-level assignment (no indent, not def/class/import/from/if/for/while/try/with)
    if (/^\w/.test(line) && /=/.test(line) && !/^(def|class|import|from|if|elif|else|for|while|try|except|finally|with|return|raise|assert|pass|break|continue)/.test(line.trim())) {
      // Likely a global assignment
      if (!/^[A-Z_]+\s*=/.test(line.trim())) {
        // Not a constant (UPPER_CASE)
        globalAssignments++;
      }
    }
  }
  if (globalAssignments > 3) {
    issues.push({
      type: "code_smell",
      severity: "warning",
      message: `${globalAssignments} mutable global variables detected -- consider encapsulating in a class or function`,
    });
  }

  // --- MAGIC NUMBERS ---
  let magicNumbers = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#") || line.startsWith("import") || line.startsWith("from")) continue;
    // Find numeric literals not in common patterns
    const nums = line.match(/(?<!\w)\d+\.?\d*(?!\w)/g);
    if (nums) {
      for (const n of nums) {
        const val = parseFloat(n);
        if (val !== 0 && val !== 1 && val !== 2 && val !== -1 && val !== 100) {
          // Check if it is in an assignment to UPPER_CASE (constant definition)
          if (!/^[A-Z_]+\s*=/.test(line)) {
            magicNumbers++;
          }
        }
      }
    }
  }
  if (magicNumbers > 5) {
    issues.push({
      type: "code_smell",
      severity: "info",
      message: `${magicNumbers} magic numbers detected -- consider defining named constants`,
    });
  }

  // --- NESTING DEPTH ---
  const maxNest = countIndentLevels(code);
  if (maxNest > 5) {
    issues.push({
      type: "structure",
      severity: "warning",
      message: `Maximum nesting depth is ${maxNest} levels -- consider flattening logic`,
    });
  } else if (maxNest > 4) {
    issues.push({
      type: "structure",
      severity: "info",
      message: `Nesting depth reaches ${maxNest} levels -- watch for complexity`,
    });
  }

  // --- IMPORT ORGANIZATION ---
  const importLines = [];
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(import |from )/.test(lines[i])) {
      importLines.push(i);
      lastImportLine = i;
    }
  }
  // Check for scattered imports (imports after code)
  if (importLines.length > 0) {
    const firstCodeLine = lines.findIndex(
      (l, idx) =>
        l.trim() !== "" &&
        !l.trim().startsWith("#") &&
        !l.trim().startsWith("import") &&
        !l.trim().startsWith("from") &&
        !l.trim().startsWith('"""') &&
        !l.trim().startsWith("'''")
    );
    if (firstCodeLine >= 0 && lastImportLine > firstCodeLine) {
      issues.push({
        type: "imports",
        severity: "info",
        message: "Imports are scattered throughout the file -- PEP 8 recommends grouping imports at the top",
      });
    }
  }

  // --- LINE LENGTH ---
  let longLines = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 120) {
      longLines++;
    }
  }
  if (longLines > 0) {
    issues.push({
      type: "style",
      severity: "info",
      message: `${longLines} line(s) exceed 120 characters`,
    });
  }

  // --- STRENGTHS ---
  if (syntaxValid) strengths.push("Code parses without syntax errors");
  if (functions.length > 0 && functions.every((f) => f.length <= 30)) {
    strengths.push("All functions are concise (<30 lines)");
  }
  if (maxNest <= 3) strengths.push("Clean nesting structure");
  if (importLines.length > 0 && lastImportLine < (lines.findIndex((l) => l.trim() !== "" && !l.trim().startsWith("#") && !l.trim().startsWith("import") && !l.trim().startsWith("from")) || 9999)) {
    strengths.push("Imports are well-organized at the top");
  }

  // --- GRADING ---
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  const score = Math.max(0, 100 - warnings * 15 - infos * 5 - (syntaxValid ? 0 : 30));

  let grade;
  if (!syntaxValid) {
    grade = "D";
  } else if (score >= 85) {
    grade = "A";
  } else if (score >= 70) {
    grade = "B";
  } else if (score >= 50) {
    grade = "C";
  } else {
    grade = "D";
  }

  return {
    grade,
    score,
    syntaxValid,
    syntaxError,
    issues,
    strengths,
    stats: {
      totalLines: lines.length,
      codeLines: nonEmptyLines.length,
      functions: functions.length,
      classes: classes.length,
      maxNesting: maxNest,
      importCount: importLines.length,
    },
  };
}

// --- Learning Path Generator ---
function generateLearningPath(result) {
  const suggestions = [];

  if (!result.syntaxValid) {
    suggestions.push({
      topic: "Python Syntax Fundamentals",
      reason: "Your code has syntax errors that prevent parsing",
      resources: [
        "docs.python.org/3/tutorial/",
        "realpython.com/python-syntax/",
      ],
    });
  }

  const docIssues = result.issues.filter((i) => i.type === "documentation");
  if (docIssues.length > 0) {
    suggestions.push({
      topic: "Writing Effective Docstrings",
      reason: "Some functions lack documentation",
      resources: [
        "PEP 257 -- Docstring Conventions",
        "realpython.com/documenting-python-code/",
      ],
    });
  }

  const structIssues = result.issues.filter((i) => i.type === "structure");
  if (structIssues.length > 0) {
    suggestions.push({
      topic: "Code Refactoring Patterns",
      reason: "Some functions are long or deeply nested",
      resources: [
        "refactoring.guru/refactoring",
        "Martin Fowler: Refactoring (book)",
      ],
    });
  }

  const typeIssues = result.issues.filter((i) => i.type === "type_hints");
  if (typeIssues.length > 0) {
    suggestions.push({
      topic: "Python Type Annotations",
      reason: "Adding type hints improves readability and tooling support",
      resources: [
        "PEP 484 -- Type Hints",
        "mypy.readthedocs.io",
      ],
    });
  }

  const smellIssues = result.issues.filter((i) => i.type === "code_smell");
  if (smellIssues.length > 0) {
    suggestions.push({
      topic: "Clean Code Practices",
      reason: "Code smells detected (bare excepts, globals, magic numbers)",
      resources: [
        "PEP 8 -- Style Guide for Python Code",
        "Clean Code by Robert C. Martin (book)",
      ],
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      topic: "Advanced Python Patterns",
      reason: "Your code quality is strong -- explore advanced topics",
      resources: [
        "Fluent Python by Luciano Ramalho",
        "docs.python.org/3/library/typing.html",
      ],
    });
  }

  return suggestions;
}

// --- Grade color mapping ---
const gradeColors = {
  A: { bg: "#059669", text: "#ecfdf5", label: "Excellent" },
  B: { bg: "#2563eb", text: "#eff6ff", label: "Good" },
  C: { bg: "#d97706", text: "#fffbeb", label: "Needs Improvement" },
  D: { bg: "#dc2626", text: "#fef2f2", label: "Significant Issues" },
};

const severityColors = {
  warning: "#f59e0b",
  info: "#3b82f6",
  error: "#ef4444",
};

const typeLabels = {
  naming: "Naming",
  documentation: "Docs",
  structure: "Structure",
  type_hints: "Types",
  code_smell: "Code Smell",
  imports: "Imports",
  style: "Style",
};

// --- Sample Code ---
const sampleCode = `def calculateArea(width, height):
    result = width * height
    return result

class myRectangle:
    def __init__(self, w, h):
        self.w = w
        self.h = h

    def area(self):
        return self.w * self.h

    def perimeter(self):
        return (self.w + self.h) * 2

def processData(data):
    try:
        for item in data:
            if item > 0:
                if item < 100:
                    if item != 42:
                        result = item * 3.14159
                        print(result)
    except:
        print("error")

import os
import sys
`;

// --- Main App Component ---
export default function AICELS() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);
  const [learningPath, setLearningPath] = useState(null);
  const [activeTab, setActiveTab] = useState("issues");
  const [showAbout, setShowAbout] = useState(false);
  const textareaRef = useRef(null);

  const handleEvaluate = () => {
    // *** BUG FIX: reject empty/whitespace-only input ***
    if (!code.trim()) {
      setResult({
        grade: null,
        score: 0,
        syntaxValid: false,
        syntaxError: "No code provided",
        issues: [],
        strengths: [],
        stats: { totalLines: 0, codeLines: 0, functions: 0, classes: 0, maxNesting: 0, importCount: 0 },
        empty: true,
      });
      setLearningPath(null);
      return;
    }

    const analysis = analyzeCode(code);
    setResult(analysis);
    setLearningPath(generateLearningPath(analysis));
    setActiveTab("issues");
  };

  const handleLoadSample = () => {
    setCode(sampleCode);
    setResult(null);
    setLearningPath(null);
  };

  const handleClear = () => {
    setCode("");
    setResult(null);
    setLearningPath(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      setCode(code.substring(0, start) + "    " + code.substring(end));
      setTimeout(() => {
        e.target.selectionStart = e.target.selectionEnd = start + 4;
      }, 0);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(145deg, #0a0e17 0%, #121a2e 50%, #0d1321 100%)",
      color: "#c8d6e5",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Source Code Pro', monospace",
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(90deg, rgba(16,24,48,0.95), rgba(20,30,55,0.9))",
        borderBottom: "1px solid rgba(99,179,237,0.15)",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: 36, height: 36,
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 700, color: "#fff",
          }}>A</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.05em" }}>
              AICELS
            </div>
            <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em" }}>
              AI CODE EVALUATOR &amp; LEARNING SYSTEM
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={() => setShowAbout(!showAbout)}
            style={{
              background: "transparent",
              border: "1px solid rgba(99,179,237,0.2)",
              color: "#94a3b8",
              padding: "6px 14px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { e.target.style.borderColor = "#3b82f6"; e.target.style.color = "#e2e8f0"; }}
            onMouseLeave={(e) => { e.target.style.borderColor = "rgba(99,179,237,0.2)"; e.target.style.color = "#94a3b8"; }}
          >
            {showAbout ? "Close" : "About"}
          </button>
          <a
            href="https://github.com/Starborn/AICELS"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: "transparent",
              border: "1px solid rgba(99,179,237,0.2)",
              color: "#94a3b8",
              padding: "6px 14px",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 12,
            }}
          >
            GitHub
          </a>
        </div>
      </div>

      {/* About Panel */}
      {showAbout && (
        <div style={{
          background: "rgba(16,24,48,0.9)",
          borderBottom: "1px solid rgba(99,179,237,0.1)",
          padding: "20px 24px",
          fontSize: 13,
          lineHeight: 1.7,
          maxWidth: 800,
        }}>
          <p style={{ margin: "0 0 8px", color: "#94a3b8" }}>
            AICELS performs static analysis of Python code using AST-based pattern detection.
            It checks naming conventions, documentation, function structure, type hints,
            code smells, import organization, and nesting depth -- then generates a
            personalized learning path based on the results.
          </p>
          <p style={{ margin: 0, color: "#64748b", fontSize: 11 }}>
            W3C AIKR CG / Epistemic Systems Lab -- Ronin Institute
          </p>
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: result ? "1fr 1fr" : "1fr",
        gap: 0,
        minHeight: "calc(100vh - 70px)",
      }}>
        {/* Left: Code Input */}
        <div style={{
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          borderRight: result ? "1px solid rgba(99,179,237,0.1)" : "none",
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}>
            <span style={{ fontSize: 12, color: "#64748b", letterSpacing: "0.1em" }}>
              PYTHON CODE INPUT
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={handleLoadSample}
                style={{
                  background: "rgba(59,130,246,0.1)",
                  border: "1px solid rgba(59,130,246,0.25)",
                  color: "#60a5fa",
                  padding: "5px 12px",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                Load Sample
              </button>
              <button
                onClick={handleClear}
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  color: "#f87171",
                  padding: "5px 12px",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste your Python code here..."
            spellCheck={false}
            style={{
              flex: 1,
              minHeight: 400,
              background: "rgba(6,10,20,0.8)",
              border: "1px solid rgba(99,179,237,0.12)",
              borderRadius: 8,
              padding: 16,
              color: "#c8d6e5",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 13,
              lineHeight: 1.6,
              resize: "vertical",
              outline: "none",
              tabSize: 4,
            }}
          />

          <button
            onClick={handleEvaluate}
            style={{
              marginTop: 12,
              padding: "12px 24px",
              background: "linear-gradient(135deg, #3b82f6, #6366f1)",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: "0.05em",
              transition: "transform 0.15s, box-shadow 0.15s",
              boxShadow: "0 4px 15px rgba(59,130,246,0.25)",
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = "translateY(-1px)";
              e.target.style.boxShadow = "0 6px 20px rgba(59,130,246,0.35)";
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = "translateY(0)";
              e.target.style.boxShadow = "0 4px 15px rgba(59,130,246,0.25)";
            }}
          >
            Evaluate Code
          </button>

          {code.trim() && (
            <div style={{
              marginTop: 10,
              fontSize: 11,
              color: "#475569",
              display: "flex",
              gap: 16,
            }}>
              <span>{code.split("\n").length} lines</span>
              <span>{code.trim().split(/\s+/).length} tokens</span>
              <span>{code.length} chars</span>
            </div>
          )}
        </div>

        {/* Right: Results */}
        {result && (
          <div style={{
            padding: "20px 24px",
            overflowY: "auto",
            maxHeight: "calc(100vh - 70px)",
          }}>
            {/* Empty input message */}
            {result.empty ? (
              <div style={{
                textAlign: "center",
                padding: "60px 20px",
              }}>
                <div style={{
                  fontSize: 48, marginBottom: 16, opacity: 0.4,
                }}>
                  &#8709;
                </div>
                <div style={{ fontSize: 16, color: "#94a3b8", marginBottom: 8 }}>
                  No code to evaluate
                </div>
                <div style={{ fontSize: 13, color: "#475569" }}>
                  Paste some Python code or load the sample to get started.
                </div>
              </div>
            ) : (
              <>
                {/* Grade Badge */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 20,
                  marginBottom: 24,
                  padding: "20px 24px",
                  background: "rgba(6,10,20,0.6)",
                  borderRadius: 12,
                  border: `1px solid ${gradeColors[result.grade]?.bg || "#475569"}33`,
                }}>
                  <div style={{
                    width: 72, height: 72,
                    borderRadius: 16,
                    background: `linear-gradient(135deg, ${gradeColors[result.grade]?.bg}cc, ${gradeColors[result.grade]?.bg}88)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 36, fontWeight: 800, color: "#fff",
                    boxShadow: `0 4px 20px ${gradeColors[result.grade]?.bg}44`,
                  }}>
                    {result.grade}
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>
                      {gradeColors[result.grade]?.label}
                    </div>
                    <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
                      Score: {result.score}/100
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      {result.issues.length} issue{result.issues.length !== 1 ? "s" : ""} found
                      {" -- "}
                      {result.strengths.length} strength{result.strengths.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>

                {/* Stats Row */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                  marginBottom: 20,
                }}>
                  {[
                    { label: "Lines", value: result.stats.codeLines },
                    { label: "Functions", value: result.stats.functions },
                    { label: "Classes", value: result.stats.classes },
                  ].map((s) => (
                    <div key={s.label} style={{
                      background: "rgba(6,10,20,0.5)",
                      borderRadius: 8,
                      padding: "10px 14px",
                      border: "1px solid rgba(99,179,237,0.08)",
                    }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.1em" }}>{s.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>

                {/* Tabs */}
                <div style={{
                  display: "flex",
                  gap: 2,
                  marginBottom: 16,
                  background: "rgba(6,10,20,0.4)",
                  borderRadius: 8,
                  padding: 3,
                }}>
                  {["issues", "strengths", "learning"].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        background: activeTab === tab ? "rgba(59,130,246,0.15)" : "transparent",
                        border: activeTab === tab ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent",
                        borderRadius: 6,
                        color: activeTab === tab ? "#60a5fa" : "#64748b",
                        fontSize: 12,
                        fontWeight: activeTab === tab ? 600 : 400,
                        cursor: "pointer",
                        textTransform: "capitalize",
                      }}
                    >
                      {tab === "learning" ? "Learning Path" : tab}
                      {tab === "issues" && ` (${result.issues.length})`}
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                <div style={{ minHeight: 200 }}>
                  {activeTab === "issues" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {result.issues.length === 0 ? (
                        <div style={{
                          padding: 24, textAlign: "center", color: "#059669",
                          background: "rgba(5,150,105,0.06)", borderRadius: 8,
                          border: "1px solid rgba(5,150,105,0.15)",
                        }}>
                          No issues detected
                        </div>
                      ) : (
                        result.issues.map((issue, idx) => (
                          <div key={idx} style={{
                            padding: "12px 14px",
                            background: "rgba(6,10,20,0.5)",
                            borderRadius: 8,
                            borderLeft: `3px solid ${severityColors[issue.severity]}`,
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                          }}>
                            <span style={{
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: `${severityColors[issue.severity]}18`,
                              color: severityColors[issue.severity],
                              whiteSpace: "nowrap",
                              fontWeight: 600,
                            }}>
                              {typeLabels[issue.type] || issue.type}
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, color: "#c8d6e5", lineHeight: 1.5 }}>
                                {issue.message}
                              </div>
                              {issue.line && (
                                <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>
                                  Line {issue.line}
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {activeTab === "strengths" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {result.strengths.length === 0 ? (
                        <div style={{
                          padding: 24, textAlign: "center", color: "#64748b",
                          background: "rgba(6,10,20,0.3)", borderRadius: 8,
                        }}>
                          No particular strengths detected -- keep improving
                        </div>
                      ) : (
                        result.strengths.map((s, idx) => (
                          <div key={idx} style={{
                            padding: "12px 14px",
                            background: "rgba(5,150,105,0.06)",
                            borderRadius: 8,
                            borderLeft: "3px solid #059669",
                            fontSize: 12,
                            color: "#a7f3d0",
                          }}>
                            {s}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {activeTab === "learning" && learningPath && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {learningPath.map((item, idx) => (
                        <div key={idx} style={{
                          padding: "16px",
                          background: "rgba(6,10,20,0.5)",
                          borderRadius: 8,
                          border: "1px solid rgba(99,179,237,0.08)",
                        }}>
                          <div style={{
                            fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 6,
                          }}>
                            {idx + 1}. {item.topic}
                          </div>
                          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10, lineHeight: 1.5 }}>
                            {item.reason}
                          </div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>
                            {item.resources.map((r, ri) => (
                              <div key={ri} style={{ marginBottom: 3 }}>
                                &rarr; {r}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
