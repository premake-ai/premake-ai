# premake-api: Node 22 for the server, Python 3.12 + CadQuery (OpenCascade) to read STEP files.
FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm
# OpenCascade / VTK want these shared libraries even without a display
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxrender1 libxext6 libsm6 libxcursor1 libxft2 libxinerama1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY py/requirements.txt py/requirements.txt
RUN pip install --no-cache-dir -r py/requirements.txt \
  && python3 -c "import cadquery, OCP; print('cadquery', cadquery.__version__)"
COPY package.json server.js ./
COPY src ./src
COPY py ./py
ENV NODE_ENV=production PYTHON=python3 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server.js"]
