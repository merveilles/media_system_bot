"use strict";

require('dotenv').config()
const nedb = require('nedb')
const fs = require('fs')



async function init(){
	var mind = new nedb({
	  filename: __dirname + '/mind.db',
	  autoload: true
	})
	mind.loadDatabase()

	//faun is the principle member, initializations will be attributed to them, and the admin category will be pre-seeded with them
	const principalId = "U046QG9FT"

	await mind.insert([
		{t:'group', name:'admin', editors:['admin'], blame:principalId},
		{t:'membership', memberId:principalId, group:'admin', blame:principalId}
		{t:'global', lastTick:null}
	]);
}

init()