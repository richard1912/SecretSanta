FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy application code
COPY . .

# Create directories
RUN mkdir -p public data

# Expose port
EXPOSE 8003

# Run the application
CMD ["npm", "start"]
