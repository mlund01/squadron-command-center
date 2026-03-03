# Stage 1: Build React frontend
FROM node:22-alpine AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
COPY vendor/ ./vendor/
COPY internal/ ./internal/
COPY main.go ./
COPY --from=frontend /app/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -mod=vendor -o commander .

# Stage 3: Minimal runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/commander ./commander
COPY --from=builder /app/web/dist ./web/dist
EXPOSE 8080
CMD ["/app/commander", "-web-dir", "/app/web/dist"]
