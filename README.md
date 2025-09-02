# antisocial-media  
This is essentially a simple social media page with support for things like sharing photos, video links, text posts, and so on.  
Python in the backend, log in with discord to make comments and posts.  
  
Install requirements:  
Configure a discord application and set up oauth. Configure client id, client secret, and redirect URL there.  
You will also need to enable the "identify" scope.  
  
Once you have configured your discord app, set enviroment variables accordingly:  
For windows users, fill in the variables as needed and run this in terminal.  
setx DISCORD_CLIENT_ID "x"  
setx DISCORD_CLIENT_SECRET "x"  
setx DISCORD_REDIRECT_URI "http://localhost:5173/callback"  
python server.py  
  
Once you have successfully run the application and logged in with discord, locate your user in users.json  
Change your user to is_admin true. //this will give your user access to the admin panel with various page settings  
