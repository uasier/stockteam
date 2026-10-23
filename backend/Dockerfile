FROM python:3.12-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.9.2 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
RUN python manage.py collectstatic --noinput

EXPOSE 8000
CMD ["sh", "-c", "until python -c \"import socket; socket.create_connection(('mysql', 3306), 2).close()\"; do sleep 2; done; python manage.py migrate && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 --timeout 60"]
