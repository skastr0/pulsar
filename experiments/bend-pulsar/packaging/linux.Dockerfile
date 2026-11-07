# Builder for the Linux engine binaries: clang + musl, so `-static` gives a
# binary with no libc dependency that runs on any Linux (glibc or musl).
# The base is pinned by digest (a multi-arch index: one image per --platform).
FROM alpine:3.22@sha256:bfe7ceb9f09ec0566c48fb93356e45a47a00be5a1dd14fa5b909e7709c66b034
RUN apk add --no-cache clang20 musl-dev bash file
WORKDIR /w
