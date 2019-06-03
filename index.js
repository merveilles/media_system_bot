"use strict";

require(`dotenv`).config()
const termpose = require(`./termpose`)
const express = require(`express`)
const bodyParser = require(`body-parser`)
const request = require(`request`)
// const { RTMClient } = require(`@slack/rtm-api`)
const { createEventAdapter } = require(`@slack/events-api`)
const valueEqual = require(`fast-deep-equal`)
const nedb = require(`nedb-promises`)
const fs = require(`fs`)

let conf = JSON.parse(fs.readFileSync(__dirname + `/config.json`, `utf8`))
let secrets = JSON.parse(fs.readFileSync(__dirname + `/secrets.json`, `utf8`))

let mind = nedb.create({
  filename: __dirname + `/mind.db`,
  autoload: true
})

const slackEvents = createEventAdapter(secrets.slack_signing_secret)

const app = express()
// Starts server
const port = process.env.PORT || conf.port
app.listen(port, function() {
  console.log(`Bot is listening on port ` + port)
})



//handle auth? I just copied this from the tutorial and I don't know if it even does anything
app.get(`/oauth`, function(req, res) {
  // When a user authorizes an app, a code query parameter is passed on the oAuth endpoint. If that code is not there, we respond with an error message
  if (!req.query.code) {
    res.status(500)
    res.send({Error: `Looks like we're not getting code.`})
    console.log(`Looks like we're not getting code.`)
  } else {
    console.log(`doing oauth.`)
    // If it's there...

    // We'll do a GET call to Slack's `oauth.access` endpoint, passing our app's client ID, client secret, and the code we just got as query parameters.
    request({
      url: `https://slack.com/api/oauth.access`, //URL to hit
      qs: {code: req.query.code, client_id: conf.slack_client_id, client_secret: conf.slack_client_secret}, //Query string data
      method: `GET`, //Specify the method
    }, function (error, response, body) {
      if (error) {
        console.log(error)
      } else {
        console.log(body)
        res.json(body)
      }
    })
  }
});




async function sendMessage(channel, msg){
  let data = {form: {
    token: secrets.slack_token,
    channel,
    text: msg
  }}
  request.post(`https://slack.com/api/chat.postMessage`, data, function (error, response, body) {})
  // await rtmclient.sendMessage(msg, channel)
}


// rtmclient.on('message', (event)=>{
//   receiveMessageEvent(event)
// })

// ;(async () => {
//   await rtmclient.start();
// })();



app.use(bodyParser.urlencoded({extended: true}))
app.use(bodyParser.json())
app.post(`/slack`, (req, res) => {
  if(req.body.type == `url_verification`){
    res.send(req.body.challenge)
  }else{
    //then it's probably a command? there doesn't seem to be a type field for commands :<
    if(req.body.command == `/prod_media_system`){
      res.send(`hears slack`)
      // res.send({channel: req.body.channel_id, text:`system online`})
    }else{
      res.send({text:`system confused`})
    }
  }
})
app.post('/', (req, res) => {
  console.log(`why is someone calling this url`, req.headers, req.body)
  if(req.body.type == `url_verification`){
    res.send(req.body.challenge)
  }else{
    //then it's probably a command? there doesn't seem to be a type field for commands :<
    if(req.body.command == `/prod_media_system`){
      res.send(`system online`)
    }else{
      res.send({text:`system confused`})
    }
  }
})


slackEvents.on('message', receiveMessageEvent)

function receiveMessageEvent(event){
  let command = /^(system|computer)[^a-z],?(.*)/.exec(event.text);
  if(command){
    try{
      let term = termpose.Woodslist.parseSingle(command[2])
      systemCommandInvocation(event, term)
    }catch(e){
      sendMessage(event.channel, `That violated the woodslist parser. You will need to speak more clearly.`)
    }
  }
}

function tellCantEdit(channel, caster, g){
  let allowedEditors = ``
  if(g.editors.includes(g.name)){
    allowedEditors += `either in it, or `
  }
  allowedEditors += `in `
  for(var gn of g.editors){
    if(gn != g.name){
      allowedEditors += gn + `, `
    }
  }
  sendMessage(channel, `<@${caster}> to edit that group you need to be ${allowedEditors}`)
  res.send(`you can't edit that`)
}

async function createGroupIfNotExistent(groupName){
  if(groupName == `self`){
    throw new Error(`you can't create a self group`)
  }
  let matchingGroup = await mind.findOne({t:'group', name:groupName})
  if(!matchingGroup){
    await mind.insert({t:`group`, name:groupName, editors:[groupName, `admin`]})
  }
  return await mind.findOne({t:`group`, name:groupName})
}

async function canEdit(member, groupName){
  let ge = await mind.findOne({t:`group`, name:groupName})
  let me = await mind.find({t:`membership`, memberId:member}).exec()
  return ge && me && ge.editors.some((e)=>{
    if(e.user){
      return e.user == member
    }else{
      return me.some((m)=> m.group == e)
    }
  })
}

function readIDField(str){
  let mg = /<@(U[A-Z0-9]*)>/.exec(str)
  return mg && mg[1]
}

async function findGroup(groupName){
  return await mind.findOne({t:`group`, name:groupName})
}

async function systemCommandInvocation(event, command){ //command is a term
  console.log(event)
  // console.log(command)
  // console.log(command.s)
  console.log(command.toString())
  let key = command.initialString()
  let caster = event.user
  
  let reply = (msg)=> sendMessage(event.channel, `<@${caster}> ${msg}`)
  
  let validateMemberReferenceOrRebuke = (str)=> {
    if(str == `me` || str == `my`){
      return caster
    }else{
      let memberId = readIDField(str)
      if(memberId){
        return memberId
      }else{
        reply(`No, you need to reference the user by @handle, otherwise there's a potential for ambiguity. (There's a way I could figure out the ambiguity most of the time, but it would be too much work.)`)
        return null
      }
    }
  }
  let requireCommandHas = (number)=> {
    if(!command.s || command.s.length < number){
      reply(`not enough variables`)
      return false
    }else{
      return true
    }
  }
  
  async function getBalanceOpenAccountIfNeeded(memberId){
    let account = await mind.findOne({t:`bankAccount`, member:memberId})
    if(!account){
      await mind.insert({t:`bankAccount`, member:memberId, balance:1})
      return 1
    }else{
      return account.balance
    }
  }
  
  async function removeMoney(casterId, amount){
    
    let balance = getBalanceOpenAccountIfNeeded(caster)
    
    if(amount > balance){
      reply(`you don't have that much money`)
      return false
    }
    
    let newBalance = balance - amount
    await mind.update({t:`bankAccount`, member:caster}, {$set: {balance:newBalance}})
    return true
  }
  
  async function giveMoney(recipientId, amount){
    let balance = getBalanceOpenAccountIfNeeded(recipientId)
    await setBalance(balance + amount)
  }
  
  async function setBalance(memberId, newBalance){
    await mind.update({t:`bankAccount`, member:memberId}, {$set: {balance:newBalance}})
  }
  
  async function findOrMakeWager(claim){
    let bl = await mind.findOne({t:`wager`, claim:claim})
    if(!bl){
      bl = {t:`wager`, claim:claim, closingDate:null, declaredOutcome:null, outcomeDeclarer:null}
      await mind.insert(bl)
    }
    return bl
  }
  
  async function gatherBets(claim){
    let bets = await mind.find({t:`bet`, claim:claim}).exec()
    let bm = new Map()
    for(var b of bets){
      let mm = bm.get(b.outcome)
      if(!mm){
        mm = []
        bm.set(b.outcome, mm)
      }
      mm.push({member:b.better, amount:b.amount})
    }
    let ret = []
    for(let mm of bm){
      ret.push({outcome:mm[0], bets:mm[1]})
    }
    return ret
  }
  
  if(key == `engage`){
    if(command.s && command.s.some((st)=> st.initialString() == `me`)){
      reply(`:black-eye:`)
    }else{
      sendMessage(event.channel, `:black-eye:`)
    }
  }else if(key == `title`){
    if(!requireCommandHas(3)){ return }
    
    let appointee = validateMemberReferenceOrRebuke(command.s[1].initialString())
    if(appointee == null){ return }
    
    //establish group
    let groupName = command.s[2].asArrayOfStrings()
    let pm = await mind.findOne({t:`membership`, memberId:appointee, group:groupName})
    if(pm){
      reply(`they're already in that group`)
      return
    }
    let g = await mind.findOne({t:`group`, name:groupName})
    let justCreated = false
    if(g == null){
      //create it
      let editors = [`self`, `admin`]
      mind.insert({t:`group`, name:groupName, editors, blame:caster})
      justCreated = true
      g = await mind.findOne({t:`group`, name:groupName})
    }
    
    //insert
    if(justCreated){
      await mind.insert({t:`membership`, group:groupName, memberId:appointee, blame:caster})
    }else{
      if(await canEdit(caster, groupName)){
        await mind.insert({t:`membership`, memberId:appointee, group:groupName, blame:caster})
      }else{
        tellCantEdit(event.channel, caster, g)
        return
      }
    }
    
    //report
    let count = await mind.count({t:`membership`, group:groupName})
    if(count == 1){
      reply(`<@${appointee}> becomes the first ${groupName}`)
    }else if(count == 2){
      reply(`<@${appointee}> becomes the second ${groupName}`)
    }else{
      reply(`<@${appointee}> joins the ${count - 1} ${groupName}`)
    }
  }else if(key == `detitle`){
    if(!requireCommandHas(3)){ return }
    
    let appointee = validateMemberReferenceOrRebuke(command.s[1].initialString())
    if(appointee == null){ return }
    
    let groupName = command.s[2].asArrayOfStrings()
    let group = await findGroup(groupName)
    
    if(!group){
      reply(`that title's not a thing`)
      return
    }
    
    if((await mind.count({t:'membership', memberId:appointee})) == 0){
      reply(`they didn't have that title to begin with`)
      return
    }
    
    if(await canEdit(caster, groupName)){
      await mind.remove({t:`membership`, memberId:appointee, group:groupName})
    }else{
      tellCantEdit(event.channel, caster, group)
      return
    }
  }else if(key == `give`){
    if(!requireCommandHas(3)){ return }
    
    let appointee = validateMemberReferenceOrRebuke(command.s[1].initialString())
    if(appointee == null){ return }
    if(appointee == caster){
      reply(`assinine`)
      return
    }
    
    let amount = parseFloat(command.s[2].initialString())
    if(amount == 0 || isNaN(amount)){
      reply(`invalid payment quantity`)
      return
    }
    
    if(!await removeMoney(caster, amount)){ return }
    
    await giveMoney(appointee, amount)
    
    sendMessage(event.channel, `ok`)
  }else if(key == `bet`){
    if(!requireCommandHas(6)){ return }
    
    let amount = parseFloat(command.s[1].initialString())
    if(amount == 0 || isNaN(amount)){
      reply(`invalid payment quantity`)
      return
    }
    
    // command.s[2] == `that`
    
    let claim = command.s[3].initialString()
    
    // command.s[4] == `is`
    
    let outcome = command.s[5].initialString()
    
    let wager = await findOrMakeWager(claim)
    
    if(wager.closing && wager.closing < new Date()){
      reply(`that wager has already closed`)
      return
    }
    
    if(wager.freezing && wager.freezing < new Date()){
      reply(`that wager has frozen, no more bets`)
      return
    }
    
    let b = await mind.findOne({t:`bet`, claim, better:caster})
    if(b){
      reply(`you can't change your bet`)
      return
    }else{
      await mind.insert({t:'bet', claim, better:caster, amount, outcome})
    }
    
    sendMessage(event.channel, `registered`)
  }else if(key == `tell`){
    if(!requireCommandHas(2)){ return }
    
    let entityType = command.s[1].initialString()
    switch(entityType){
    case `wager`:
      if(!requireCommandHas(3)){ return }
      let claim = command.s[2].initialString()
      
      let w = await mind.findOne({t:'wager', claim:claim})
      if(!w){
        reply(`there is no wager about that claim`)
        return
      }
      
      let ret = ``
      
      if(w.description){
        ret += `description: ${w.description}\n`
      }
      
      let bets = await gatherBets(claim)
      if(bets.length == 0){
        reply(`no one has bet on this wager`)
      }else{
        let msg = `this wager has\n`
        for(var b of bets){
          msg += `  bets for ${b.outcome}, `
          for(var bb of b.bets){
            msg += `${bb.member}:${bb.stake}  `
          }
          msg += '\n'
        }
        reply(msg)
      }
    break
    case `money`:
      let whosAccount = caster
      if(command.s.length > 2){
        whosAccount = validateMemberReferenceOrRebuke(command.s[2])
        if(!whosAccount){ return }
      }
    
      let balance = await getBalanceOpenAccountIfNeeded(whosAccount)
      
      let repm = (whosAccount == caster ? `you have ` : `<@${whosAccount}> has `)
      reply(`${repm} ${balance} money`)
    break
    default:
      reply(`I don't know about any ${entityType}s`)
    }
    
  }else{
    sendMessage(event.channel, `:question:`)
  }
}



// async function considerTicking(){
//   let gi = await mind.findOne({t:'global'})
//   if(gi.lastTick == undefined){
//     tick(conf.standardTickInterval)
//     await mind.update({t:'global'}, {$set: {lastTick:new Date()}})
//   }else{
//     tick((new Date().value - gi.lastTick.value)/1000)
//     gi.lastTick = new Date()
//     setTimeout(conf.standardTickInterval, considerTicking)
//   }
// }

// async function tick(timeElapsed){
  //I don't actually want redistribution. I'd rather do LR... but there's no reason to do that if we don't have enough of an economy for the token to be worth anything
  // await tickRedistribution(timeElapsed)
// }

// async function tickRedistribution(timeElapsed){
//   let accounts = await mind.find({t:'bankAccount'}, {member:1, balance:1}).exec()
//   let m = new Map()
//   const returnPerSecond = 0.006
//   const thisReturn = Math.pow(returnPerSecond, timeElapsed)
//   let total = 0
//   for(var a : accounts){
//     total += a.balance
//     m.set(a.member, a.balance)
//   }
//   let average = total/accounts.length
//   await mind.update({t:'bankAccount'}, )
// }





// considerTicking()