FROM node:10-alpine
WORKDIR /usr/src/app
ADD package*.json ./
RUN npm install
COPY index.js .
CMD [ "npm", "start" ]