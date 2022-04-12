#!bash
npm run package
git commit -m  $1 --all    
git push 
git tag -f ez1
git push -f --tags  