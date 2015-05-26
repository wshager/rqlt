({define:typeof define!="undefined"?define:function(deps, factory){module.exports = factory(exports, require("./parser"));}}).
define(["exports", "./parser"], function(exports, parser, Deferred){
	
	function Transpiler(execute){
		this.dict = {};
		this.lib = {};
	}
	
	function stringify(args){
		var str = JSON.stringify(args);
		return str.length>2 ? ","+str.substring(1,str.length-1) : "";
	}
	
	Transpiler.prototype.use = function(value,params,callback){
		// TODO filter and separate core definitions
		var core = value.args;
		var reqs = core.map(function(_){
			return "intern/dojo/text!/raddled/"+_+".rad";
		});
		var self = this;
		require(core,function(){
			var libs = Array.prototype.slice.call(arguments);
			libs.forEach(function(lib,i){
				self.lib[core[i]] = lib;
			});
			require(reqs,function(){
				var deps = Array.prototype.slice.call(arguments);
				deps.forEach(function(dep,i){
					var parsed = parser.parse(dep);
					if(parsed.args.length) self.process(parsed,{use:core[i]},callback);
				});
				if(callback) callback();
			});
		});
	};
	
	Transpiler.prototype.transpile = function(value,params){
		var ret = this.process(value,params).filter(function(_){
			return !!_;
		}).pop();
		if(params.callback) {
			
		}
		return ret;
	};
	
	Transpiler.prototype.process = function(value,params,callback){
		var args = Array.prototype.slice.call(arguments);
		var value = args.shift();
		var params = args.length>1 && typeof args[0]!="function" ? args.shift() : {};
		var callback = args.shift();
		if(typeof value == "string") value = parser.parse(value);
		if(value.name=="use"){
			this.use(value,params,callback);
		} else if(value.name=="define"){
			this.define(value,params);
		} else if(value.name=="" && value.args) {
			var self=this,use,define=[],args=[];
			value.args.forEach(function(arg){
				if(arg.name=="use") {
					use = arg;
				} else if(arg.name=="define"){
					define.push(arg);
				} else {
					args.push(arg);
				}
			});
			var cb = !params.use && !!callback ? callback : function(){};
			callback = function(){
				define.forEach(function(arg){
					self.define(arg,params);
				});
				var ret = args.map(function(arg){
					return self.process(arg,params,callback);
				}).pop();
				cb(null,ret);
			};
			use ? this.use(use,params,callback) : callback();
		} else {
			return this.compile(value);
		}
	};
	
	Transpiler.prototype.typeCheck = function(stack,type){
		var l = stack.length;
		var last = stack[l-1];
		console.warn("last",last,type)
	};
	
	Transpiler.prototype.coerce = function(value,type){
		// should we infer and check?
		if (type === 'string') {
			value = value ? '' + value : '';
		} else if (type === 'number') {
			value = +value;
		} else if (type === 'boolean') {
			value = !!value;
		} else if (type === 'array') {
			if(!(value instanceof Array)) value = new Array();
		} else if (type === 'object') {
			if(!(value instanceof Object)) value = new Object();
		} else if (type === 'function') {
			value = this.dict[value].body.toString();
		}
		return value;
	};
	
	Transpiler.prototype.type = function(t){
		// 0: null
		// 1: number
		// 2: string
		// 3: boolean
		// 4: map
		// 5: function
		// 6: any
		// 7: number*
		// 8: string*
		// 9: boolean*
		// 10: map*
		// 11: function*
		// 12: any*
		var ts = ["number","string","boolean","map","function","any"];
		if(t.match(/\*/)){
			t = t.replace(/\*/,"");
			return ts.indexOf(t)+7;
		}
		return ts.indexOf(t)+1;
	};
	
	Transpiler.prototype.matchTypes = function(i,o){
		var ti = this.type(i);
		var to = this.type(o);
		console.warn(i,ti,"->",o,to);
		if(ti==to) return true;
		if(ti>0&&ti<6 && to==6) return true;
		if(to>0&&to<6 && ti==6) return true;
		if(ti>6&&ti<12 && to==12) return true;
		if(to>6&&to<12 && ti==12) return true;
		return false;
	};
	
	Transpiler.prototype.compile = function(value,parent){
		// TODO compile literals like ?
		var self = this;
		var name,sigs=new Array(2),args=[];
		if(parent){
			// called from define, so compile to a definition body
			var name = parent.name;
			var args = parent.args;
			var sigs = parent.sigs;
		}
		var a = [];
		var arity = args.length;
		for(var i=1;i<=arity;i++){
			a.push("arg"+i);
		}
		var fa = a.slice(0);
		fa.unshift("arg0");
		var fargs = fa.join(",");
		// always compose
		if(!(value instanceof Array)) value = [value];
		// compose the functions in the array
		var map = function(acc,i,o){
			var v = value.shift();
			var def = self.dict[v.name];
			if(!def) throw new Error("Definition for "+v.name+" not in dictionary");
			if(i && !self.matchTypes(i,def.sigs[0])){
				throw new Error("Type signatures do not match: "+i+"->"+def.sigs[0]);
			}
			acc.unshift("("+def.body.toString()+").call(this,");
			// TODO static arg type checks
			var args;
			if(v.args){
				if(!def.args || v.args.length!=def.args.length){
					throw new Error("Argument length incorrect");
				}
				// replace ? args in order
				args = v.args.map(function(_,i){
					if(_=="?") {
						return a.shift();
					} else {
						var t = def.args[i];
						var r = self.coerce(_,t,true)
						return t=="function" ? r : JSON.stringify(r);
					}
				},this);
			} else if(def.args) {
				throw new Error("No arguments supplied");
			}
			acc.push((args.length ? "," : "")+args.join(",")+")");
			if(value.length) {
				return map(acc,def.sigs[1],o);
			} else {
				if(o && !self.matchTypes(o,def.sigs[1])){
					throw new Error("Type signatures do not match: "+o+"->"+def.sigs[1]);
				}
				return acc;
			}
		}
		var f = map([a],sigs[0],sigs[1]);
		// put default input arg in a
		a.unshift("arg0");
		var index = f.indexOf(a);
		f[index] = a.join(",");
		return new Function("return function "+name+"("+fargs+"){ return "+f.join("")+";}")();
	};
	
	Transpiler.prototype.define = function(value,params){
		var l = value.args.length;
		var name = value.args[0];
		var sigs = [], args = [];
		var body,def;
		if(l==2){
			// lookup
			def = this.dict[value.args[1]];
			if(!def) throw new Error("Unknown reference in definition "+name);
			sigs = def.sigs;
			args = def.args;
			body = def.body;
		} else if(l==3 || l==4){
			// core
			sigs = value.args[1];
			args = value.args[2];
			if(l==4){
				body = value.args[3];
			} else {
				// known definition
				if(params.use) body = this.lib[params.use][name];
			}
		}
		def = {
			name:name,
			sigs:sigs,
			args:args,
			body:body
		};
		if(l==4) {
			// compile definition
			def.body = this.compile(body,def);
		}
		this.dict[name] = def;
		return def;
	};
	exports.Transpiler = Transpiler;

	return exports;
});