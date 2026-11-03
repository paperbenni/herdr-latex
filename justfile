# Install locked development dependencies (Python 3.11+, Node 22.15+, uv, just).
setup:
    uv sync --locked
    npm ci

# Run all portable checks. Native Herdr validation is a separate recipe.
check: lint format-check typecheck test

lint:
    uv run --locked ruff check .

format-check:
    uv run --locked ruff format --check .
    npm run format:check

format:
    uv run --locked ruff check --fix .
    uv run --locked ruff format .
    npm run format

typecheck:
    uv run --locked mypy
    npm run typecheck

test:
    uv run --locked pytest
    npm test

# Includes integration tests when latexmk, pdflatex and pdfinfo are installed.
coverage:
    uv run --locked pytest --cov --cov-report=term-missing

# Requires the desktop app, independent of the portable test suite.
check-native:
    herdr-app check ./mods/latex

# Copy the launcher and shared modules as a bundle into a personal toolbar mod.
toolbar-bundle destination:
    uv run --locked python scripts/toolbar_bundle.py '{{destination}}'
