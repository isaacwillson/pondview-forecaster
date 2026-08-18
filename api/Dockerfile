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

# Application code, the model artifact, and its context sidecar (bands, "typical"
# baseline, /whatif defaults).
COPY api/main.py ${LAMBDA_TASK_ROOT}/main.py
COPY api/prompt.py ${LAMBDA_TASK_ROOT}/prompt.py
COPY api/aggregate.py ${LAMBDA_TASK_ROOT}/aggregate.py
COPY api/tools.py ${LAMBDA_TASK_ROOT}/tools.py
COPY api/chat.py ${LAMBDA_TASK_ROOT}/chat.py
COPY model/model.joblib ${LAMBDA_TASK_ROOT}/model.joblib
COPY model/model_context.json ${LAMBDA_TASK_ROOT}/model_context.json

# main.py reads these to locate the artifacts inside the image (the defaults point at
# the repo layout, which doesn't exist here). ${LAMBDA_TASK_ROOT} resolves to /var/task.
ENV MODEL_PATH=${LAMBDA_TASK_ROOT}/model.joblib
ENV CONTEXT_PATH=${LAMBDA_TASK_ROOT}/model_context.json

# Allowed CORS origins (comma-separated). main.py reads ALLOWED_ORIGINS; override at
# deploy time (e.g. to add a preview/staging URL) without rebuilding the image.
ENV ALLOWED_ORIGINS=https://pondviewforecast.vercel.app

# ANTHROPIC_API_KEY is deliberately NOT set here. An ENV line bakes the value into an
# image layer, readable by anyone who can pull from ECR. Set it on the Lambda function
# instead (console, or `aws lambda update-function-configuration --environment`), or
# from Secrets Manager. Without it /chat returns 503 and the other endpoints are
# unaffected, so a deployment that forgets it degrades rather than breaks.
#
# The chat path also needs a longer timeout than the default: worst case is two model
# round trips plus an Open-Meteo call. 30s is comfortable.

# Handler = "<module>.<callable>": main.py's `handler = Mangum(app)`.
CMD ["main.handler"]
