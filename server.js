const Websocket =require('ws');

function startServer(port=8000)
{
    const wss=new Websocket.Server({port});

    console.log('starting websocket server on ws//localhost:${port}');

    wss.on('connection',(ws)=>
    {
        console.log('client connected');

        ws.on('close',()=>
        {
            console.log('client disconnected');
        });

        ws.on('error',(err)=>
        {
            console.log('Client error:',err.message);
        });
    });

    wss.on('listening',()=>
    {
        console.log('server is now listening for connection');
    });

    wss.on('error',(err)=>
    {
        console.log('server error',err.message);
    });
}

module.exports={startServer};

if(require.main === module)
{
    startServer(9000);
}