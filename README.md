# AICELS -- AI Code Evaluator and Learning System

Static analysis tool for Python code quality assessment with personalized learning paths.

## What it does

AICELS performs client-side AST-based analysis of Python code, checking:

- **Naming conventions** -- PEP 8 snake_case for functions, PascalCase for classes
- **Documentation** -- docstring coverage across functions
- **Function structure** -- length, nesting depth
- **Type hints** -- return type annotation usage
- **Code smells** -- bare excepts, mutable globals, magic numbers
- **Import organization** -- grouped at top per PEP 8
- **Line length** -- 120-character threshold

Quality analysis is **decoupled from code execution** -- AICELS never runs your code, it analyzes structure only. This means it works safely on any codebase regardless of dependencies.

## Bug fixes (v2.0)

- **Empty input no longer returns grade A** -- submitting empty or whitespace-only code now shows a clear "no code to evaluate" message instead of a false top grade
- **Quality analysis decoupled from execution** -- the original Gradio version used `exec()` as a gate for quality checks, meaning import-heavy or long scripts would fail before being analyzed. This version performs pure static analysis

## Deployment

### Vercel (React)

1. Fork this repo
2. Import into Vercel
3. Set framework to "Vite" or use the included config
4. Deploy

### Static HTML

Open `index.html` directly in a browser -- no build step needed.

### GitHub Pages

Push to a `gh-pages` branch or enable Pages from `main` with `/docs` as source.

## Origin

Originally built as a Google Colab notebook and HuggingFace Space (STARBORN/AICELS). This version is a complete rewrite as a standalone web application.

## Credits

W3C AI Knowledge Representation Community Group (AIKR CG)
Epistemic Systems Lab -- Ronin Institute

## License

MIT
