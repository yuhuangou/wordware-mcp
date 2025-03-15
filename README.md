# wordware-mcp

The Wordware MCP (Master Control Program) server allows you to run your Wordware apps locally. This enables you to integrate Wordware's powerful AI flows directly into your local development environment, making it easier to test and develop applications that leverage Wordware's capabilities.

## Create an account

To start, you'll need a Wordware account. Head to [wordware.ai](http://wordware.ai), sign in and create an account

## Create an API key

For your wordware flows to be accessible via MCP, you'll need to create an API key. For that, click on your profile picture in the top right corner > API keys > Create a new key > Copy your key

## Create an app

Now it's time to get creative. Create a wordware app for whatever you want to achieve, or feel free to fork an app from the explore page (https://app.wordware.ai/explore).

## Deploy your app

For your app to be triggered as MCP, you'll need to deploy it. To do that, head to your app. You should see a "Deploy" button in the top right corner. Then head to the deployment page.

## Get the `app_id`

On the deployment page, you'll see your deployment url: `https://app.wordware.ai/explore/apps/{app_id}`. Get your app_id from there

## Clone the github repo

Clone the repo and get started with your local MCP server!

## Populate the `.env` file

Rename the `.env.example` file to `.env` and populate it with your own values.

- `WORDWARE_API_KEY`={your-api-key you got from the previous step}
- `APP_IDS`={array of your app ids}

## Build the server

Install dependencies with `npm install` and build the server with `npm run build`.

## Modify your Claude desktop config file

You need to have Claude for Desktop installed to test the server. If you do, you need to modify the config file to use the MCP server. The claude desktop config should be located here:

`~/Library/Application\ Support/Claude/claude_desktop_config.json`

Then, add the following to the file (make sure to replace `/ABSOLUTE/PATH/TO/PARENT/FOLDER/wordware-mcp/build/index.js` with the absolute path to the `index.js` file in the `build` folder of this repository):

```json
{
  "mcpServers": {
    "wordware": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/PARENT/FOLDER/wordware-mcp/build/index.js"]
    }
  }
}
```

## Have fun!

Now you can have fun with your local MCP server!
