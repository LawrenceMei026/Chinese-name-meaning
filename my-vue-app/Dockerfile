FROM kicbase/stable:v0.0.50
WORKDIR /app

COPY dist ./dist
COPY serve.py ./serve.py

EXPOSE 80
ENTRYPOINT []
CMD ["python3", "serve.py"]
