FROM python:3.12-slim

WORKDIR /app

COPY ml/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY ml /app

ENV ML_MODEL_PATH=/app/artifacts/noshow-v1.joblib

EXPOSE 8001

CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "8001"]
