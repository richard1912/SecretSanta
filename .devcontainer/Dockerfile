FROM node:18-bookworm-slim

# Install dependencies for dev container features
RUN apt-get update && apt-get install -y \
    bash \
    zsh \
    git \
    curl \
    wget \
    ca-certificates \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Configure sudo for node user (already exists in base image)
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Create public and data directories
RUN mkdir -p public data

# Set proper permissions
RUN chown -R node:node /app

# Expose port
EXPOSE 8003

# Default command (will be overridden by dev container)
CMD ["npm", "start"]
