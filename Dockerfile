FROM python:3.13-slim

WORKDIR /app
COPY . /app

ENV PYTHONUNBUFFERED=1 \
    VV_HOST=0.0.0.0 \
    VV_DB_PATH=/data/talent.db

RUN mkdir -p /data

EXPOSE 8087
CMD ["python", "server.py"]
