# Lambda container image for the Pondview arrival forecaster.
#
# The build context is the REPO ROOT (not api/), because the image needs both the
# API code under api/ and the trained artifact under model/. Build with:
#
#   docker build --platform linux/amd64 -f api/Dockerfile -t pondview-forecast:latest .
#
# --platform linux/amd64 pins the x86_64 architecture the Lambda function must also
# be configured for; drop it only if you deploy an arm64 (Graviton) function.
FROM public.ecr.aws/lambda/python:3.11

# Dependencies first: this layer is cached and only rebuilds when requirements change.
# The model is trained under Python 3.11 with these exact pinned versions, so the
# pickle loads here with no version mismatch. The pins are also chosen to have
# glibc-2.17 (manylinux2014) wheels -- this base is Amazon Linux 2 (glibc 2.26), which
# can install those as prebuilt binaries, so no C compiler is needed in the image.
COPY api/requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Application code and the model artifact.
COPY api/main.py ${LAMBDA_TASK_ROOT}/main.py
COPY model/model.joblib ${LAMBDA_TASK_ROOT}/model.joblib

# main.py reads MODEL_PATH to locate the artifact inside the image (default is the
# repo layout, which doesn't exist here). ${LAMBDA_TASK_ROOT} resolves to /var/task.
ENV MODEL_PATH=${LAMBDA_TASK_ROOT}/model.joblib

# Allowed CORS origins (comma-separated). main.py reads ALLOWED_ORIGINS; override at
# deploy time (e.g. to add a staging URL) without rebuilding the image.
ENV ALLOWED_ORIGINS=https://pondviewpool.vercel.app

# Handler = "<module>.<callable>": main.py's `handler = Mangum(app)`.
CMD ["main.handler"]
